import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { trigger, style, animate, transition, keyframes } from '@angular/animations';
import { CommonModule } from '@angular/common';

export type NodeType = 'city' | 'fortress' | 'forge' | 'camp';
export type UnitType = 'light' | 'heavy';

export interface GameNode {
  id: number;
  x: number; // logical X (0 to 10000 for a large map)
  y: number; // logical Y (0 to 10000)
  troops: number;
  owner: 'player' | 'enemy' | 'neutral' | 'ai_macro' | 'ai_micro';
  type: NodeType;
  level: number;
  capacity: number;
  pushX: number; // For push physics
  pushY: number;
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
  progress: number; // Distance traveled
  totalDistance: number;
  targetNodeId: number | null;
  combating: boolean;
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
    ])
  ]
})
export class AppComponent implements OnInit, OnDestroy {
  showSplash = true;
  gameState: 'menu' | 'playing' | 'gameover' | 'simulation' = 'menu';
  
  // Large Logical Map Size
  MAP_WIDTH = 4000;
  MAP_HEIGHT = 4000;

  nodes: GameNode[] = [];
  movements: TroopMovement[] = [];
  movementIdCounter = 0;
  
  selectedNode: GameNode | null = null;
  dragCurrentX = 0;
  dragCurrentY = 0;
  isLineDragging = false;

  sendPercentage: number = 0.5; // 25%, 50%, 100%

  gameLoop: any;
  lastTick = 0;

  // AI Orchestrator Timers
  lastMicroTick = 0;
  lastMacroTick = 0;

  // Camera (Pan & Zoom)
  scale = 0.5; // Start zoomed out
  panX = 0;
  panY = 0;
  
  // Touch Handling for Camera
  isPanning = false;
  lastTouchX = 0;
  lastTouchY = 0;
  initialPinchDistance = 0;
  initialScale = 1;

  @ViewChild('mapContainer') mapContainer!: ElementRef;

  ngOnInit() {
    setTimeout(() => {
      this.showSplash = false;
      this.centerCamera();
    }, 3000);
  }

  ngOnDestroy() {
    this.stopGame();
  }

  centerCamera() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.panX = (vw / 2) - (this.MAP_WIDTH * this.scale / 2);
    this.panY = (vh / 2) - (this.MAP_HEIGHT * this.scale / 2);
  }

  setPercentage(p: number) {
    this.sendPercentage = p;
  }

  startGame(mode: 'player' | 'simulation' = 'player') {
    this.gameState = mode === 'simulation' ? 'simulation' : 'playing';
    
    // Spread nodes across a large 4000x4000 map
    if (mode === 'player') {
      this.nodes = [
        { id: 1, x: 800, y: 3200, troops: 15000, owner: 'player', type: 'city', level: 1, capacity: 50000, pushX:0, pushY:0 },
        { id: 2, x: 3200, y: 800, troops: 15000, owner: 'enemy', type: 'city', level: 1, capacity: 50000, pushX:0, pushY:0 },
        { id: 3, x: 2000, y: 2000, troops: 25000, owner: 'neutral', type: 'fortress', level: 2, capacity: 100000, pushX:0, pushY:0 },
        { id: 4, x: 800, y: 800, troops: 5000, owner: 'neutral', type: 'forge', level: 1, capacity: 30000, pushX:0, pushY:0 },
        { id: 5, x: 3200, y: 3200, troops: 5000, owner: 'neutral', type: 'forge', level: 1, capacity: 30000, pushX:0, pushY:0 },
        { id: 6, x: 2000, y: 800, troops: 8000, owner: 'neutral', type: 'city', level: 1, capacity: 50000, pushX:0, pushY:0 },
        { id: 7, x: 2000, y: 3200, troops: 8000, owner: 'neutral', type: 'city', level: 1, capacity: 50000, pushX:0, pushY:0 }
      ];
    } else {
      this.nodes = [
        { id: 1, x: 400, y: 400, troops: 20000, owner: 'ai_micro', type: 'city', level: 1, capacity: 50000, pushX:0, pushY:0 },
        { id: 2, x: 3600, y: 3600, troops: 20000, owner: 'ai_macro', type: 'city', level: 1, capacity: 50000, pushX:0, pushY:0 },
        { id: 3, x: 2000, y: 2000, troops: 50000, owner: 'neutral', type: 'fortress', level: 3, capacity: 200000, pushX:0, pushY:0 },
        { id: 4, x: 400, y: 2000, troops: 5000, owner: 'neutral', type: 'forge', level: 1, capacity: 30000, pushX:0, pushY:0 },
        { id: 5, x: 2000, y: 400, troops: 5000, owner: 'neutral', type: 'forge', level: 1, capacity: 30000, pushX:0, pushY:0 },
        { id: 6, x: 3600, y: 2000, troops: 5000, owner: 'neutral', type: 'city', level: 1, capacity: 50000, pushX:0, pushY:0 },
        { id: 7, x: 2000, y: 3600, troops: 5000, owner: 'neutral', type: 'city', level: 1, capacity: 50000, pushX:0, pushY:0 },
      ];
    }

    this.centerCamera();
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
    if (amount < 1000) return Math.floor(Math.max(0, amount)).toString();
    if (amount < 1000000) return (amount / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return (amount / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }

  tick(time: number) {
    const dt = (time - this.lastTick) / 1000;
    this.lastTick = time;

    // 1. Economy & Generation
    this.nodes.forEach(n => {
      if (n.owner !== 'neutral') {
        let genRate = 2000 * n.level;
        if (n.type === 'forge') genRate *= 0.5;
        if (n.type === 'fortress') genRate *= 0.3;
        if (n.type === 'camp') genRate *= 0.0;
        
        n.troops += genRate * dt; 

        if (n.troops > n.capacity) {
          n.troops -= (n.troops - n.capacity) * 0.1 * dt; 
        }
      }

      // Decay physics push
      n.pushX *= 0.9;
      n.pushY *= 0.9;
      // Clamp to map bounds
      n.x = Math.max(40, Math.min(this.MAP_WIDTH - 40, n.x + n.pushX * dt));
      n.y = Math.max(40, Math.min(this.MAP_HEIGHT - 40, n.y + n.pushY * dt));
    });

    // 2. Movements & Combat
    for (let i = this.movements.length - 1; i >= 0; i--) {
      const m = this.movements[i];
      
      if (!m.combating) {
        // Speed in logical units per second
        const speed = m.unitType === 'heavy' ? 400 : 800;
        m.progress += speed * dt;
        
        if (m.progress >= m.totalDistance - 40) { // 40 is node radius
          m.combating = true;
          // If moving to empty space, create camp and finish
          if (m.targetNodeId === null) {
            this.createCamp(m);
            this.movements.splice(i, 1);
            continue;
          }
        }
      }

      if (m.combating) {
        this.processCombatTick(m, dt, i);
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

  createCamp(movement: TroopMovement) {
    const newNode: GameNode = {
      id: Math.max(...this.nodes.map(n => n.id), 0) + 1,
      x: movement.targetX,
      y: movement.targetY,
      troops: movement.amount,
      owner: movement.owner,
      type: 'camp',
      level: 1,
      capacity: 20000,
      pushX: 0, pushY: 0
    };
    this.nodes.push(newNode);
  }

  processCombatTick(movement: TroopMovement, dt: number, index: number) {
    const target = this.nodes.find(n => n.id === movement.targetNodeId);
    
    // If target destroyed by someone else, convert swarm to camp
    if (!target) {
       this.createCamp(movement);
       this.movements.splice(index, 1);
       return;
    }

    // Calculate direction vector for pushing
    const dx = target.x - movement.startX;
    const dy = target.y - movement.startY;
    const len = Math.hypot(dx, dy);
    const dirX = len > 0 ? dx / len : 0;
    const dirY = len > 0 ? dy / len : 0;

    if (target.owner === movement.owner) {
      // Reinforce rapidly
      const transferRate = 20000 * dt;
      const amountToTransfer = Math.min(movement.amount, transferRate);
      target.troops += amountToTransfer;
      movement.amount -= amountToTransfer;
      
      if (movement.amount <= 0) {
        this.movements.splice(index, 1);
      }
    } else {
      // Continuous Combat Over Time (Damage & Push)
      let combatRate = 15000 * dt; // Troops lost per tick
      let damageToTarget = combatRate;
      let damageToSwarm = combatRate;

      if (movement.unitType === 'heavy') damageToTarget *= 2.0;
      if (target.type === 'fortress') damageToTarget *= 0.5;

      // Apply Push Physics
      const pushForce = movement.unitType === 'heavy' ? 400 : 200;
      target.pushX += dirX * pushForce * dt;
      target.pushY += dirY * pushForce * dt;

      // Apply Damage
      const actualDamageTarget = Math.min(target.troops, damageToTarget);
      const actualDamageSwarm = Math.min(movement.amount, damageToSwarm);

      target.troops -= actualDamageTarget;
      movement.amount -= actualDamageSwarm;

      // Capture Logic
      if (target.troops <= 0) {
        target.owner = movement.owner;
        target.troops = movement.amount; // Remaining attackers garrison the node
        this.movements.splice(index, 1);
      } else if (movement.amount <= 0) {
        this.movements.splice(index, 1); // Attack repelled
      }
    }
  }

  upgradeNode(node: GameNode, event?: Event) {
    if (event) event.stopPropagation();
    if (node.owner !== 'player') return;
    if (node.type === 'camp') return;
    
    const cost = 10000 * node.level;
    if (node.troops >= cost && node.level < 5) {
      node.troops -= cost;
      node.level++;
      node.capacity += 50000;
    }
  }

  // --- AI ---
  runBasicEnemyAI() {
    if (Math.random() < 0.015) { 
      const enemies = this.nodes.filter(n => n.owner === 'enemy');
      if (enemies.length > 0) {
        const source = enemies[Math.floor(Math.random() * enemies.length)];
        if (source.troops > 15000 * source.level && source.level < 3 && source.type !== 'camp') {
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

    if (time - this.lastMacroTick > 2500) {
      this.lastMacroTick = time;
      const macroNodes = this.nodes.filter(n => n.owner === 'ai_macro');
      
      macroNodes.forEach(n => {
          if (n.troops > 15000 * n.level && n.level < 4 && n.type !== 'camp') {
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
                this.sendTroops(source, biggestThreat, 1.0); 
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

  // --- Input Handling (Zoom, Pan, Drag Line) ---
  
  getLogicalCoord(clientX: number, clientY: number) {
    return {
      x: (clientX - this.panX) / this.scale,
      y: (clientY - this.panY) / this.scale
    };
  }

  onTouchStart(e: TouchEvent | MouseEvent) {
    if (this.gameState === 'simulation') return;
    
    if (e instanceof TouchEvent && e.touches.length === 2) {
      // Pinch to Zoom
      this.isPanning = false;
      this.isLineDragging = false;
      this.selectedNode = null;
      this.initialPinchDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      this.initialScale = this.scale;
      return;
    }

    const clientX = e instanceof TouchEvent ? e.touches[0].clientX : e.clientX;
    const clientY = e instanceof TouchEvent ? e.touches[0].clientY : e.clientY;
    
    const logical = this.getLogicalCoord(clientX, clientY);
    const hitNode = this.getNodeAtPosition(logical.x, logical.y);

    if (hitNode && hitNode.owner === 'player') {
      this.selectedNode = hitNode;
      this.isLineDragging = true;
      this.dragCurrentX = logical.x;
      this.dragCurrentY = logical.y;
    } else {
      this.isPanning = true;
      this.lastTouchX = clientX;
      this.lastTouchY = clientY;
    }
  }

  onTouchMove(e: TouchEvent | MouseEvent) {
    if (e instanceof TouchEvent && e.touches.length === 2) {
      // Handle Pinch
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const newScale = this.initialScale * (dist / this.initialPinchDistance);
      this.scale = Math.max(0.2, Math.min(newScale, 2.0)); // Clamp scale
      return;
    }

    const clientX = e instanceof TouchEvent ? e.touches[0].clientX : e.clientX;
    const clientY = e instanceof TouchEvent ? e.touches[0].clientY : e.clientY;

    if (this.isLineDragging && this.selectedNode) {
      const logical = this.getLogicalCoord(clientX, clientY);
      this.dragCurrentX = logical.x;
      this.dragCurrentY = logical.y;
    } else if (this.isPanning) {
      const dx = clientX - this.lastTouchX;
      const dy = clientY - this.lastTouchY;
      this.panX += dx;
      this.panY += dy;
      this.lastTouchX = clientX;
      this.lastTouchY = clientY;
    }
  }

  onTouchEnd(e: TouchEvent | MouseEvent) {
    if (this.isLineDragging && this.selectedNode) {
      const targetNode = this.getNodeAtPosition(this.dragCurrentX, this.dragCurrentY);
      if (targetNode && targetNode.id !== this.selectedNode.id) {
        this.sendTroops(this.selectedNode, targetNode, this.sendPercentage);
      } else if (!targetNode) {
        this.sendTroopsToPoint(this.selectedNode, this.dragCurrentX, this.dragCurrentY, this.sendPercentage);
      }
    }

    this.isLineDragging = false;
    this.isPanning = false;
    this.selectedNode = null;
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const zoomIntensity = 0.1;
    const wheel = e.deltaY < 0 ? 1 : -1;
    const zoomFactor = Math.exp(wheel * zoomIntensity);
    
    // Zoom towards mouse pointer
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    const newScale = Math.max(0.2, Math.min(this.scale * zoomFactor, 2.0));
    
    // Adjust pan to keep point under mouse
    this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
    this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
    
    this.scale = newScale;
  }

  getNodeAtPosition(logicalX: number, logicalY: number): GameNode | null {
    for (const n of this.nodes) {
      if (Math.hypot(n.x - logicalX, n.y - logicalY) < 45) return n;
    }
    return null;
  }

  sendTroops(source: GameNode, target: GameNode, percentage: number) {
    this.createMovement(source, target.x, target.y, percentage, target.id);
  }

  sendTroopsToPoint(source: GameNode, targetX: number, targetY: number, percentage: number) {
    this.createMovement(source, targetX, targetY, percentage, null);
  }

  private createMovement(source: GameNode, targetX: number, targetY: number, percentage: number, targetId: number | null) {
    const amount = Math.floor(source.troops * percentage);
    if (amount <= 0) return;
    
    source.troops -= amount;
    const dist = Math.hypot(targetX - source.x, targetY - source.y);
    
    this.movements.push({
      id: this.movementIdCounter++,
      startX: source.x,
      startY: source.y,
      targetX: targetX,
      targetY: targetY,
      amount,
      owner: source.owner,
      unitType: source.type === 'forge' ? 'heavy' : 'light',
      progress: 0,
      totalDistance: dist,
      targetNodeId: targetId,
      combating: false
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
