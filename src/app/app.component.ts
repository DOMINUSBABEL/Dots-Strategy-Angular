import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { trigger, state, style, animate, transition, keyframes } from '@angular/animations';
import { CommonModule } from '@angular/common';

export type NodeType = 'city' | 'fortress' | 'forge';
export type UnitType = 'light' | 'heavy';

export interface GameNode {
  id: number;
  x: number;
  y: number;
  troops: number;
  owner: 'player' | 'enemy' | 'neutral' | 'ai_macro' | 'ai_micro';
  type: NodeType;
  level: number;
  capacity: number;
}

export interface TroopMovement {
  id: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  amount: number;
  owner: 'player' | 'enemy' | 'neutral' | 'ai_macro' | 'ai_micro';
  unitType: UnitType;
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

  sendPercentage: number = 0.5; // 25%, 50%, 100%

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

  setPercentage(p: number) {
    this.sendPercentage = p;
  }

  startGame(mode: 'player' | 'simulation' = 'player') {
    this.gameState = mode === 'simulation' ? 'simulation' : 'playing';
    
    if (mode === 'player') {
      this.nodes = [
        { id: 1, x: 20, y: 80, troops: 15000, owner: 'player', type: 'city', level: 1, capacity: 50000 },
        { id: 2, x: 80, y: 20, troops: 15000, owner: 'enemy', type: 'city', level: 1, capacity: 50000 },
        { id: 3, x: 50, y: 50, troops: 25000, owner: 'neutral', type: 'fortress', level: 2, capacity: 100000 },
        { id: 4, x: 20, y: 20, troops: 5000, owner: 'neutral', type: 'forge', level: 1, capacity: 30000 },
        { id: 5, x: 80, y: 80, troops: 5000, owner: 'neutral', type: 'forge', level: 1, capacity: 30000 }
      ];
    } else {
      this.nodes = [
        { id: 1, x: 10, y: 10, troops: 20000, owner: 'ai_micro', type: 'city', level: 1, capacity: 50000 },
        { id: 2, x: 90, y: 90, troops: 20000, owner: 'ai_macro', type: 'city', level: 1, capacity: 50000 },
        { id: 3, x: 50, y: 50, troops: 50000, owner: 'neutral', type: 'fortress', level: 3, capacity: 200000 },
        { id: 4, x: 10, y: 50, troops: 5000, owner: 'neutral', type: 'forge', level: 1, capacity: 30000 },
        { id: 5, x: 50, y: 10, troops: 5000, owner: 'neutral', type: 'forge', level: 1, capacity: 30000 },
        { id: 6, x: 90, y: 50, troops: 5000, owner: 'neutral', type: 'city', level: 1, capacity: 50000 },
        { id: 7, x: 50, y: 90, troops: 5000, owner: 'neutral', type: 'city', level: 1, capacity: 50000 },
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

    // 1. Economy & Generation
    this.nodes.forEach(n => {
      if (n.owner !== 'neutral') {
        // Base generation based on type and level
        let genRate = 2000 * n.level;
        if (n.type === 'forge') genRate *= 0.5; // Forges produce slower but make heavy troops
        if (n.type === 'fortress') genRate *= 0.3; // Fortresses produce very slowly
        
        n.troops += genRate * dt; 

        // Starvation Mechanic: If over capacity, lose troops rapidly
        if (n.troops > n.capacity) {
          n.troops -= (n.troops - n.capacity) * 0.1 * dt; // 10% decay of excess per second
        }
      }
    });

    // 2. Movements
    for (let i = this.movements.length - 1; i >= 0; i--) {
      const m = this.movements[i];
      // Heavy units move 50% slower
      const speed = m.unitType === 'heavy' ? 0.4 : 0.8;
      m.progress += speed * dt; 
      
      if (m.progress >= 1) {
        this.resolveCombat(m);
        this.movements.splice(i, 1);
      }
    }

    // 3. AI
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
      // Reinforcements
      target.troops += movement.amount;
    } else {
      // Combat
      let attackPower = movement.amount;
      if (movement.unitType === 'heavy') attackPower *= 2.0; // Heavy units deal double damage
      
      // Fortress reduces incoming damage by 50%
      if (target.type === 'fortress') attackPower *= 0.5;

      target.troops -= attackPower;
      
      if (target.troops < 0) {
        target.owner = movement.owner;
        target.troops = Math.abs(target.troops);
        // On capture, cap is preserved but we don't change the node type
      }
    }
  }

  upgradeNode(node: GameNode, event?: Event) {
    if (event) event.stopPropagation();
    if (node.owner !== 'player') return;
    
    const cost = 10000 * node.level;
    if (node.troops >= cost && node.level < 5) {
      node.troops -= cost;
      node.level++;
      node.capacity += 50000;
    }
  }

  runBasicEnemyAI() {
    if (Math.random() < 0.015) { 
      const enemies = this.nodes.filter(n => n.owner === 'enemy');
      if (enemies.length > 0) {
        const source = enemies[Math.floor(Math.random() * enemies.length)];
        // Upgrades if rich
        if (source.troops > 15000 * source.level && source.level < 3) {
            source.troops -= 10000 * source.level;
            source.level++;
            source.capacity += 50000;
        } else if (source.troops > source.capacity * 0.5) {
          const targets = this.nodes.filter(n => n.id !== source.id);
          const target = targets[Math.floor(Math.random() * targets.length)];
          this.sendTroops(source, target, 0.5);
        }
      }
    }
  }

  runSimulationAI(time: number) {
    // Micro AI
    if (time - this.lastMicroTick > 300) {
      this.lastMicroTick = time;
      const microNodes = this.nodes.filter(n => n.owner === 'ai_micro');
      microNodes.forEach(source => {
        if (source.troops > 5000) {
          let closest: GameNode | null = null;
          let minD = Infinity;
          this.nodes.filter(n => n.owner !== 'ai_micro').forEach(target => {
             const d = Math.hypot(target.x - source.x, target.y - source.y);
             if (d < minD) { minD = d; closest = target; }
          });
          if (closest) this.sendTroops(source, closest, 0.25);
        }
      });
    }

    // Macro AI
    if (time - this.lastMacroTick > 2500) {
      this.lastMacroTick = time;
      const macroNodes = this.nodes.filter(n => n.owner === 'ai_macro');
      
      // Macro AI prioritizes upgrading nodes first
      macroNodes.forEach(n => {
          if (n.troops > 15000 * n.level && n.level < 4) {
              n.troops -= 10000 * n.level;
              n.level++;
              n.capacity += 50000;
          }
      });

      let totalTroops = macroNodes.reduce((acc, n) => acc + n.troops, 0);
      if (totalTroops > 80000) {
        let biggestThreat = this.nodes.filter(n => n.owner !== 'ai_macro' && n.owner !== 'neutral')
          .sort((a,b) => b.troops - a.troops)[0];
        if (!biggestThreat) biggestThreat = this.nodes.filter(n => n.owner === 'neutral').sort((a,b) => b.troops - a.troops)[0];

        if (biggestThreat) {
          macroNodes.forEach(source => {
            if (source.troops > source.capacity * 0.3) {
                this.sendTroops(source, biggestThreat, 1.0); // FULL SEND
            }
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

  onTouchStart(e: TouchEvent | MouseEvent, node: GameNode) {
    if (node.owner !== 'player' && this.gameState !== 'simulation') return;
    if (this.gameState === 'simulation') return; 
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
      this.sendTroops(this.selectedNode, targetNode, this.sendPercentage);
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

  sendTroops(source: GameNode, target: GameNode, percentage: number) {
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
      unitType: source.type === 'forge' ? 'heavy' : 'light',
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

  getCost(node: GameNode): string {
    return this.formatTroops(10000 * node.level);
  }
}
