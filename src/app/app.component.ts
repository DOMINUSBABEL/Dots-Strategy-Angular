import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { trigger, style, animate, transition, keyframes } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Peer from 'peerjs';

export type NodeType = 'city' | 'fortress' | 'forge' | 'camp';
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
  pushX: number;
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
  progress: number;
  totalDistance: number;
  targetNodeId: number | null;
  combating: boolean;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  animations: [
    trigger('splashFade', [
      transition(':leave', [
        animate('1s cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 0, transform: 'scale(1.1)' }))
      ])
    ]),
    trigger('uiSlideUp', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(20px)' }),
        animate('0.4s ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
      ])
    ])
  ]
})
export class AppComponent implements OnInit, OnDestroy {
  showSplash = true;
  gameState: 'menu' | 'playing' | 'gameover' | 'simulation' | 'hosting' | 'joining' = 'menu';
  
  MAP_WIDTH = 4000;
  MAP_HEIGHT = 4000;

  nodes: GameNode[] = [];
  movements: TroopMovement[] = [];
  movementIdCounter = 0;
  
  selectedNode: GameNode | null = null;
  dragCurrentX = 0;
  dragCurrentY = 0;
  isLineDragging = false;
  sendPercentage: number = 0.5;

  gameLoop: any;
  lastTick = 0;
  lastMicroTick = 0;
  lastMacroTick = 0;

  // Camera
  scale = 0.4;
  panX = 0;
  panY = 0;
  isPanning = false;
  lastTouchX = 0;
  lastTouchY = 0;
  initialPinchDistance = 0;
  initialScale = 1;

  // Multiplayer (P2P via PeerJS)
  peer: Peer | null = null;
  conn: any = null;
  myPeerId: string = '';
  joinPeerId: string = '';
  isHost = false;
  isMultiplayer = false;
  lastSyncTick = 0;
  myFaction: 'player' | 'enemy' = 'player'; // Host is player, Client is enemy

  @ViewChild('mapContainer') mapContainer!: ElementRef;

  ngOnInit() {
    setTimeout(() => {
      this.showSplash = false;
      this.centerCamera();
    }, 3000);
  }

  ngOnDestroy() {
    this.stopGame();
    if (this.peer) this.peer.destroy();
  }

  centerCamera() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.panX = (vw / 2) - (this.MAP_WIDTH * this.scale / 2);
    this.panY = (vh / 2) - (this.MAP_HEIGHT * this.scale / 2);
  }

  setPercentage(p: number) { this.sendPercentage = p; }

  // --- MULTIPLAYER SETUP ---
  initHost() {
    this.gameState = 'hosting';
    this.isHost = true;
    this.isMultiplayer = true;
    this.myFaction = 'player';
    
    this.peer = new Peer(); // Auto-generates a random ID
    this.peer.on('open', (id) => {
      this.myPeerId = id;
    });

    this.peer.on('connection', (connection) => {
      this.conn = connection;
      this.setupConnection();
      // Start the game once a client connects
      this.startGame('player'); 
    });
  }

  initJoin() {
    this.gameState = 'joining';
    this.isHost = false;
    this.isMultiplayer = true;
    this.myFaction = 'enemy'; // Client controls the 'enemy' faction visually

    this.peer = new Peer();
    this.peer.on('open', (id) => {
      this.myPeerId = id;
    });
  }

  connectToHost() {
    if (!this.joinPeerId || !this.peer) return;
    this.conn = this.peer.connect(this.joinPeerId);
    this.setupConnection();
  }

  setupConnection() {
    this.conn.on('open', () => {
      console.log('P2P Connection Established!');
      if (!this.isHost) {
        this.gameState = 'playing';
      }
    });

    this.conn.on('data', (data: any) => {
      if (this.isHost) {
        // Host receives commands from Client
        if (data.type === 'action') {
           this.processClientAction(data.action);
        }
      } else {
        // Client receives authoritative State from Host
        if (data.type === 'state') {
           this.nodes = data.state.nodes;
           this.movements = data.state.movements;
        } else if (data.type === 'gameover') {
           this.gameState = 'gameover';
           this.stopGame();
        }
      }
    });

    this.conn.on('close', () => {
      alert("Conexión perdida con el oponente.");
      this.gameState = 'menu';
      this.stopGame();
    });
  }

  processClientAction(action: any) {
    if (action.cmd === 'send') {
       const source = this.nodes.find(n => n.id === action.sourceId);
       const target = action.targetId ? this.nodes.find(n => n.id === action.targetId) : null;
       if (source && target) {
           this.sendTroops(source, target, action.percentage);
       } else if (source && !target) {
           this.sendTroopsToPoint(source, action.targetX, action.targetY, action.percentage);
       }
    } else if (action.cmd === 'upgrade') {
       const node = this.nodes.find(n => n.id === action.nodeId);
       if (node) this.upgradeNodeCore(node);
    }
  }

  // --- GAME START ---
  startGame(mode: 'player' | 'simulation' = 'player') {
    this.gameState = mode === 'simulation' ? 'simulation' : 'playing';
    this.isMultiplayer = this.conn !== null;
    this.myFaction = this.isHost || !this.isMultiplayer ? 'player' : 'enemy';

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
    this.lastSyncTick = this.lastTick;
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

  // --- GAME LOOP ---
  tick(time: number) {
    const dt = (time - this.lastTick) / 1000;
    this.lastTick = time;

    // Only Host or Singleplayer simulates physics/economy
    if (!this.isMultiplayer || this.isHost) {
      
      this.nodes.forEach(n => {
        if (n.owner !== 'neutral') {
          let genRate = 2000 * n.level;
          if (n.type === 'forge') genRate *= 0.5;
          if (n.type === 'fortress') genRate *= 0.3;
          if (n.type === 'camp') genRate *= 0.0;
          n.troops += genRate * dt; 
          if (n.troops > n.capacity) n.troops -= (n.troops - n.capacity) * 0.1 * dt; 
        }

        n.pushX *= 0.9; n.pushY *= 0.9;
        n.x = Math.max(40, Math.min(this.MAP_WIDTH - 40, n.x + n.pushX * dt));
        n.y = Math.max(40, Math.min(this.MAP_HEIGHT - 40, n.y + n.pushY * dt));
      });

      for (let i = this.movements.length - 1; i >= 0; i--) {
        const m = this.movements[i];
        if (!m.combating) {
          const speed = m.unitType === 'heavy' ? 400 : 800;
          m.progress += speed * dt;
          if (m.progress >= m.totalDistance - 40) {
            m.combating = true;
            if (m.targetNodeId === null) {
              this.createCamp(m);
              this.movements.splice(i, 1);
              continue;
            }
          }
        }
        if (m.combating) this.processCombatTick(m, dt, i);
      }

      if (this.gameState === 'playing' && !this.isMultiplayer) {
        this.runBasicEnemyAI();
      } else if (this.gameState === 'simulation') {
        this.runSimulationAI(time);
      }

      this.checkWinCondition();

      // Host Syncs state to Client (every 50ms)
      if (this.isHost && time - this.lastSyncTick > 50) {
        this.lastSyncTick = time;
        if (this.conn && this.conn.open) {
           this.conn.send({ type: 'state', state: { nodes: this.nodes, movements: this.movements } });
        }
      }
    }

    // Client still loops for local camera rendering
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
    if (!target) {
       this.createCamp(movement);
       this.movements.splice(index, 1);
       return;
    }

    const dx = target.x - movement.startX;
    const dy = target.y - movement.startY;
    const len = Math.hypot(dx, dy);
    const dirX = len > 0 ? dx / len : 0;
    const dirY = len > 0 ? dy / len : 0;

    if (target.owner === movement.owner) {
      const transferRate = 20000 * dt;
      const amountToTransfer = Math.min(movement.amount, transferRate);
      target.troops += amountToTransfer;
      movement.amount -= amountToTransfer;
      if (movement.amount <= 0) this.movements.splice(index, 1);
    } else {
      let combatRate = 15000 * dt;
      let damageToTarget = combatRate;
      let damageToSwarm = combatRate;

      if (movement.unitType === 'heavy') damageToTarget *= 2.0;
      if (target.type === 'fortress') damageToTarget *= 0.5;

      const pushForce = movement.unitType === 'heavy' ? 400 : 200;
      target.pushX += dirX * pushForce * dt;
      target.pushY += dirY * pushForce * dt;

      const actualDamageTarget = Math.min(target.troops, damageToTarget);
      const actualDamageSwarm = Math.min(movement.amount, damageToSwarm);

      target.troops -= actualDamageTarget;
      movement.amount -= actualDamageSwarm;

      if (target.troops <= 0) {
        target.owner = movement.owner;
        target.troops = movement.amount;
        this.movements.splice(index, 1);
      } else if (movement.amount <= 0) {
        this.movements.splice(index, 1);
      }
    }
  }

  upgradeNode(node: GameNode, event?: Event) {
    if (event) event.stopPropagation();
    if (node.owner !== this.myFaction) return;
    
    if (this.isMultiplayer && !this.isHost) {
      // Send command to host
      this.conn.send({ type: 'action', action: { cmd: 'upgrade', nodeId: node.id }});
    } else {
      this.upgradeNodeCore(node);
    }
  }

  upgradeNodeCore(node: GameNode) {
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
        let biggestThreat = this.nodes.filter(n => n.owner !== 'ai_macro' && n.owner !== 'neutral').sort((a,b) => b.troops - a.troops)[0];
        if (!biggestThreat) biggestThreat = this.nodes.filter(n => n.owner === 'neutral').sort((a,b) => b.troops - a.troops)[0];
        if (biggestThreat) {
          macroNodes.forEach(source => {
            if (source.troops > source.capacity * 0.3) this.sendTroops(source, biggestThreat, 1.0); 
          });
        }
      }
    }
  }

  checkWinCondition() {
    if (this.gameState === 'playing') {
      const hasPlayer = this.nodes.some(n => n.owner === 'player');
      const hasEnemy = this.nodes.some(n => n.owner === 'enemy');
      if (!hasPlayer || !hasEnemy) { 
        this.gameState = 'gameover'; 
        if (this.isHost && this.conn) this.conn.send({ type: 'gameover' });
        this.stopGame(); 
      }
    } else if (this.gameState === 'simulation') {
      const hasMicro = this.nodes.some(n => n.owner === 'ai_micro');
      const hasMacro = this.nodes.some(n => n.owner === 'ai_macro');
      if (!hasMicro || !hasMacro) { this.gameState = 'gameover'; this.stopGame(); }
    }
  }

  // --- Input Handling ---
  getLogicalCoord(clientX: number, clientY: number) {
    return { x: (clientX - this.panX) / this.scale, y: (clientY - this.panY) / this.scale };
  }

  onTouchStart(e: TouchEvent | MouseEvent) {
    if (this.gameState === 'simulation') return;
    
    if (e instanceof TouchEvent && e.touches.length === 2) {
      this.isPanning = false; this.isLineDragging = false; this.selectedNode = null;
      this.initialPinchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      this.initialScale = this.scale;
      return;
    }

    const clientX = e instanceof TouchEvent ? e.touches[0].clientX : e.clientX;
    const clientY = e instanceof TouchEvent ? e.touches[0].clientY : e.clientY;
    const logical = this.getLogicalCoord(clientX, clientY);
    const hitNode = this.getNodeAtPosition(logical.x, logical.y);

    if (hitNode && hitNode.owner === this.myFaction) {
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
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const newScale = this.initialScale * (dist / this.initialPinchDistance);
      this.scale = Math.max(0.15, Math.min(newScale, 2.5));
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
      this.panX += dx; this.panY += dy;
      this.lastTouchX = clientX; this.lastTouchY = clientY;
    }
  }

  onTouchEnd(e: TouchEvent | MouseEvent) {
    if (this.isLineDragging && this.selectedNode) {
      const targetNode = this.getNodeAtPosition(this.dragCurrentX, this.dragCurrentY);
      
      if (this.isMultiplayer && !this.isHost) {
         // Send request to host
         this.conn.send({
           type: 'action',
           action: {
             cmd: 'send',
             sourceId: this.selectedNode.id,
             targetId: targetNode ? targetNode.id : null,
             targetX: this.dragCurrentX,
             targetY: this.dragCurrentY,
             percentage: this.sendPercentage
           }
         });
      } else {
         if (targetNode && targetNode.id !== this.selectedNode.id) {
           this.sendTroops(this.selectedNode, targetNode, this.sendPercentage);
         } else if (!targetNode) {
           this.sendTroopsToPoint(this.selectedNode, this.dragCurrentX, this.dragCurrentY, this.sendPercentage);
         }
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
    const mouseX = e.clientX; const mouseY = e.clientY;
    const newScale = Math.max(0.15, Math.min(this.scale * zoomFactor, 2.5));
    
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
      startX: source.x, startY: source.y,
      targetX: targetX, targetY: targetY,
      amount, owner: source.owner,
      unitType: source.type === 'forge' ? 'heavy' : 'light',
      progress: 0, totalDistance: dist,
      targetNodeId: targetId, combating: false
    });
  }

  openBabylon() { window.open('https://babylonias.com/', '_system'); }
  copyPeerId() { navigator.clipboard.writeText(this.myPeerId); }
  goMenu() { this.gameState = 'menu'; if(this.peer) this.peer.destroy(); this.peer = null; this.conn = null; }

  getWinner(): string {
    if (this.gameState === 'playing' || this.gameState === 'gameover') {
      const won = this.nodes.some(n => n.owner === this.myFaction);
      return won ? '¡Has Vencido, Comandante!' : 'Derrota Aplastante';
    } else {
      return this.nodes.some(n => n.owner === 'ai_micro') ? '¡Victoria IA Frenética!' : '¡Victoria Gran Estrategia!';
    }
  }

  getCost(node: GameNode): string { return this.formatTroops(10000 * node.level); }
}