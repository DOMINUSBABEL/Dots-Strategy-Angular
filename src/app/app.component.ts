import { Component, OnInit, OnDestroy } from '@angular/core';
import { trigger, state, style, animate, transition, keyframes } from '@angular/animations';
import { CommonModule } from '@angular/common';

interface GameNode {
  id: number;
  x: number;
  y: number;
  troops: number;
  owner: 'player' | 'enemy' | 'neutral' | 'ai_macro' | 'ai_micro';
}

interface TroopMovement {
  id: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  amount: number;
  owner: 'player' | 'enemy' | 'neutral' | 'ai_macro' | 'ai_micro';
  progress: number;
  targetNodeId: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  animations: [
    trigger('splashFade', [
      transition(':leave', [
        animate('1s ease-in', style({ opacity: 0 }))
      ])
    ]),
    trigger('troopPulse', [
      transition('* => *', [
        animate('0.3s ease-out', keyframes([
          style({ transform: 'scale(1)', offset: 0 }),
          style({ transform: 'scale(1.2)', offset: 0.5 }),
          style({ transform: 'scale(1)', offset: 1.0 })
        ]))
      ])
    ])
  ]
})
export class AppComponent implements OnInit, OnDestroy {
  showSplash = true;
  gameState: 'menu' | 'playing' | 'gameover' | 'simulation' = 'menu';
  nodes: GameNode[] = [];
  movements: TroopMovement[] = [];
  movementIdCounter = 0;
  
  selectedNode: GameNode | null = null;
  dragCurrentX = 0;
  dragCurrentY = 0;
  isDragging = false;

  gameLoop: any;
  lastTick = 0;

  // AI Orchestrator Timers
  lastMicroTick = 0;
  lastMacroTick = 0;

  ngOnInit() {
    setTimeout(() => {
      this.showSplash = false;
    }, 3000);
  }

  ngOnDestroy() {
    this.stopGame();
  }

  startGame(mode: 'player' | 'simulation' = 'player') {
    this.gameState = mode === 'simulation' ? 'simulation' : 'playing';
    
    if (mode === 'player') {
      this.nodes = [
        { id: 1, x: 20, y: 80, troops: 50000, owner: 'player' },
        { id: 2, x: 80, y: 20, troops: 50000, owner: 'enemy' },
        { id: 3, x: 50, y: 50, troops: 10000, owner: 'neutral' },
        { id: 4, x: 20, y: 20, troops: 20000, owner: 'neutral' },
        { id: 5, x: 80, y: 80, troops: 20000, owner: 'neutral' }
      ];
    } else {
      // Simulation mode: High APM vs Macro Strategy
      this.nodes = [
        { id: 1, x: 10, y: 10, troops: 50000, owner: 'ai_micro' },
        { id: 2, x: 90, y: 90, troops: 50000, owner: 'ai_macro' },
        { id: 3, x: 50, y: 50, troops: 10000, owner: 'neutral' },
        { id: 4, x: 10, y: 50, troops: 5000, owner: 'neutral' },
        { id: 5, x: 50, y: 10, troops: 5000, owner: 'neutral' },
        { id: 6, x: 90, y: 50, troops: 5000, owner: 'neutral' },
        { id: 7, x: 50, y: 90, troops: 5000, owner: 'neutral' },
      ];
    }

    this.movements = [];
    this.lastTick = performance.now();
    this.lastMicroTick = this.lastTick;
    this.lastMacroTick = this.lastTick;
    this.gameLoop = requestAnimationFrame((t) => this.tick(t));
  }

  stopGame() {
    cancelAnimationFrame(this.gameLoop);
  }

  formatTroops(amount: number): string {
    if (amount < 1000) return Math.floor(amount).toString();
    if (amount < 1000000) return (amount / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return (amount / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }

  tick(time: number) {
    const dt = (time - this.lastTick) / 1000;
    this.lastTick = time;

    // Generar tropas: 15K por segundo para hacer el juego frenético
    this.nodes.forEach(n => {
      if (n.owner !== 'neutral') {
        n.troops += 15000 * dt; 
      }
    });

    // Mover tropas (velocidad ajustada a 1 segundo para cruzar)
    for (let i = this.movements.length - 1; i >= 0; i--) {
      const m = this.movements[i];
      m.progress += 1.0 * dt; 
      if (m.progress >= 1) {
        this.resolveCombat(m);
        this.movements.splice(i, 1);
      }
    }

    // Agent Orchestrator Logic
    if (this.gameState === 'playing') {
      this.runBasicEnemyAI();
    } else if (this.gameState === 'simulation') {
      this.runSimulationAI(time);
    }

    this.checkWinCondition();

    if (this.gameState === 'playing' || this.gameState === 'simulation') {
      this.gameLoop = requestAnimationFrame((t) => this.tick(t));
    }
  }

  resolveCombat(movement: TroopMovement) {
    const target = this.nodes.find(n => n.id === movement.targetNodeId);
    if (!target) return;

    if (target.owner === movement.owner) {
      target.troops += movement.amount;
    } else {
      target.troops -= movement.amount;
      if (target.troops < 0) {
        target.owner = movement.owner;
        target.troops = Math.abs(target.troops);
      }
    }
  }

  runBasicEnemyAI() {
    if (Math.random() < 0.02) { 
      const enemies = this.nodes.filter(n => n.owner === 'enemy');
      if (enemies.length > 0) {
        const source = enemies[Math.floor(Math.random() * enemies.length)];
        if (source.troops > 20000) {
          const targets = this.nodes.filter(n => n.id !== source.id);
          const target = targets[Math.floor(Math.random() * targets.length)];
          this.sendTroops(source, target);
        }
      }
    }
  }

  // --- ORQUESTADOR DE AGENTES (IA) ---
  runSimulationAI(time: number) {
    // 1. AI Frenética (High APM - Micro)
    // Actúa cada 300ms. Manda enjambres pequeños al nodo enemigo/neutral más cercano.
    if (time - this.lastMicroTick > 300) {
      this.lastMicroTick = time;
      const microNodes = this.nodes.filter(n => n.owner === 'ai_micro');
      microNodes.forEach(source => {
        if (source.troops > 10000) {
          // Find closest non-micro node
          let closest: GameNode | null = null;
          let minD = Infinity;
          this.nodes.filter(n => n.owner !== 'ai_micro').forEach(target => {
             const d = Math.hypot(target.x - source.x, target.y - source.y);
             if (d < minD) { minD = d; closest = target; }
          });
          if (closest) this.sendTroops(source, closest, 0.2); // Envia 20% rápido
        }
      });
    }

    // 2. AI Gran Estrategia (Macro)
    // Actúa cada 2000ms. Espera a acumular millones, y luego lanza un ataque devastador coordinado al jugador más fuerte.
    if (time - this.lastMacroTick > 2000) {
      this.lastMacroTick = time;
      const macroNodes = this.nodes.filter(n => n.owner === 'ai_macro');
      let totalTroops = macroNodes.reduce((acc, n) => acc + n.troops, 0);
      
      if (totalTroops > 150000) {
        // Encontrar la amenaza más grande
        let biggestThreat = this.nodes.filter(n => n.owner !== 'ai_macro' && n.owner !== 'neutral')
          .sort((a,b) => b.troops - a.troops)[0];
        
        if (!biggestThreat) {
           biggestThreat = this.nodes.filter(n => n.owner === 'neutral').sort((a,b) => b.troops - a.troops)[0];
        }

        if (biggestThreat) {
          // Ataque masivo desde todos los nodos de Macro al unísono
          macroNodes.forEach(source => {
            this.sendTroops(source, biggestThreat, 0.8); // Envía 80%
          });
        }
      }
    }
  }

  checkWinCondition() {
    if (this.gameState === 'playing') {
      const hasPlayer = this.nodes.some(n => n.owner === 'player');
      const hasEnemy = this.nodes.some(n => n.owner === 'enemy');
      if (!hasPlayer || !hasEnemy) { this.gameState = 'gameover'; this.stopGame(); }
    } else if (this.gameState === 'simulation') {
      const hasMicro = this.nodes.some(n => n.owner === 'ai_micro');
      const hasMacro = this.nodes.some(n => n.owner === 'ai_macro');
      if (!hasMicro || !hasMacro) { this.gameState = 'gameover'; this.stopGame(); }
    }
  }

  // Touch handlers
  onTouchStart(e: TouchEvent | MouseEvent, node: GameNode) {
    if (node.owner !== 'player' && this.gameState !== 'simulation') return;
    if (this.gameState === 'simulation') return; // Bloquear toques en simulador
    this.selectedNode = node;
    this.isDragging = true;
    this.updateDragPosition(e);
  }

  onTouchMove(e: TouchEvent | MouseEvent) {
    if (!this.isDragging) return;
    this.updateDragPosition(e);
  }

  onTouchEnd(e: TouchEvent | MouseEvent) {
    if (!this.isDragging || !this.selectedNode) return;
    this.isDragging = false;
    
    const targetNode = this.getNodeAtPosition(this.dragCurrentX, this.dragCurrentY);
    if (targetNode && targetNode.id !== this.selectedNode.id) {
      this.sendTroops(this.selectedNode, targetNode, 0.5); // Jugador manda el 50%
    }
    this.selectedNode = null;
  }

  updateDragPosition(e: TouchEvent | MouseEvent) {
    if (e instanceof TouchEvent) {
      this.dragCurrentX = e.touches[0].clientX;
      this.dragCurrentY = e.touches[0].clientY;
    } else {
      this.dragCurrentX = e.clientX;
      this.dragCurrentY = e.clientY;
    }
  }

  getNodeAtPosition(x: number, y: number): GameNode | null {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    for (const n of this.nodes) {
      const nx = (n.x / 100) * vw;
      const ny = (n.y / 100) * vh;
      if (Math.hypot(nx - x, ny - y) < 40) return n;
    }
    return null;
  }

  sendTroops(source: GameNode, target: GameNode, percentage: number = 0.5) {
    const amount = Math.floor(source.troops * percentage);
    if (amount <= 0) return;
    
    source.troops -= amount;
    this.movements.push({
      id: this.movementIdCounter++,
      startX: source.x,
      startY: source.y,
      targetX: target.x,
      targetY: target.y,
      amount,
      owner: source.owner,
      progress: 0,
      targetNodeId: target.id
    });
  }

  openBabylon() {
    window.open('https://babylonias.com/', '_system');
  }

  getWinner(): string {
    if (this.gameState === 'playing') {
      return this.nodes.some(n => n.owner === 'player') ? '¡Victoria Jugador!' : 'Derrota...';
    } else {
      return this.nodes.some(n => n.owner === 'ai_micro') ? '¡Victoria AI Micro/APM!' : '¡Victoria AI Macro!';
    }
  }
}
