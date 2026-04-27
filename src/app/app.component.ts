import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit, HostListener } from '@angular/core';
import { trigger, style, animate, transition } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Peer from 'peerjs';

export type NodeType = 'city' | 'fortress' | 'forge' | 'camp';
export type UnitType = 'light' | 'heavy';

export interface GameNode {
  id: number;
  x: number; y: number;
  troops: number;
  owner: 'player' | 'enemy' | 'neutral' | 'ai_macro' | 'ai_micro';
  type: NodeType;
  level: number; capacity: number;
  pushX: number; pushY: number;
}

export interface TroopMovement {
  id: number;
  startX: number; startY: number;
  targetX: number; targetY: number;
  amount: number;
  owner: 'player' | 'enemy' | 'neutral' | 'ai_macro' | 'ai_micro';
  unitType: UnitType;
  progress: number; totalDistance: number;
  targetNodeId: number | null;
  combating: boolean;
}

const FACTION_COLORS: Record<string, string> = {
  'player': '#00e5ff',
  'enemy': '#ff1744',
  'ai_micro': '#d500f9',
  'ai_macro': '#ff9100',
  'neutral': '#78909c'
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  animations: [
    trigger('splashFade', [transition(':leave', [animate('1s ease-in', style({ opacity: 0, transform: 'scale(1.1)' }))])]),
    trigger('uiSlideUp', [transition(':enter', [style({ opacity: 0, transform: 'translateY(20px)' }), animate('0.3s ease-out', style({ opacity: 1, transform: 'translateY(0)' }))])])
  ]
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  showSplash = true;
  gameState: 'menu' | 'playing' | 'gameover' | 'simulation' | 'hosting' | 'joining' | 'settings' = 'menu';
  
  MAP_WIDTH = 4000;
  MAP_HEIGHT = 4000;

  nodes: GameNode[] = [];
  movements: TroopMovement[] = [];
  movementIdCounter = 0;
  
  selectedNode: GameNode | null = null;
  dragCurrentX = 0; dragCurrentY = 0;
  isLineDragging = false;
  sendPercentage: number = 0.5;

  gameLoop: any;
  lastTick = 0; lastFrameTime = 0;
  lastMicroTick = 0; lastMacroTick = 0; lastSyncTick = 0;

  // Camera
  scale = 0.5; panX = 0; panY = 0;
  isPanning = false; lastTouchX = 0; lastTouchY = 0;
  initialPinchDistance = 0; initialScale = 1;

  // Engine Performance
  targetFPS = 60;
  frameInterval = 1000 / 60;
  resolutionScale = 1.0;
  dpr = 1;

  // P2P
  peer: Peer | null = null; conn: any = null;
  myPeerId: string = ''; joinPeerId: string = '';
  isHost = false; isMultiplayer = false;
  myFaction: 'player' | 'enemy' = 'player';

  // CANVAS ENGINE
  @ViewChild('gameCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  ctx!: CanvasRenderingContext2D | null;

  ngOnInit() {
    this.autoDetectPerformance();
    setTimeout(() => { this.showSplash = false; }, 3000);
  }

  ngAfterViewInit() {
    this.initCanvas();
  }

  @HostListener('window:resize')
  onResize() {
    this.initCanvas();
  }

  initCanvas() {
    if (!this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    this.dpr = (window.devicePixelRatio || 1) * this.resolutionScale;
    
    // Physical pixels
    canvas.width = window.innerWidth * this.dpr;
    canvas.height = window.innerHeight * this.dpr;
    // CSS pixels
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    
    this.ctx = canvas.getContext('2d', { alpha: false });
    
    // Initial Camera
    if (this.nodes.length === 0) {
       this.panX = (window.innerWidth / 2) - (this.MAP_WIDTH * this.scale / 2);
       this.panY = (window.innerHeight / 2) - (this.MAP_HEIGHT * this.scale / 2);
    }
  }

  autoDetectPerformance() {
    const w = window.innerWidth;
    if (w < 800) {
      this.resolutionScale = 0.75; 
      this.targetFPS = 60;
    } else {
      this.resolutionScale = 1.0;
      this.targetFPS = 120; // Allow 120 on desktop/iPad
    }
    this.updateFrameInterval();
  }

  updateFrameInterval() { this.frameInterval = 1000 / this.targetFPS; }
  setFPS(fps: number) { this.targetFPS = fps; this.updateFrameInterval(); }
  setResolution(scale: number) { this.resolutionScale = scale; this.initCanvas(); }
  openSettings() { this.gameState = 'settings'; }
  closeSettings() { this.gameState = 'menu'; }
  setPercentage(p: number) { this.sendPercentage = p; }
  openBabylon() { window.open('https://babylonias.com/', '_system'); }

  ngOnDestroy() { this.stopGame(); if (this.peer) this.peer.destroy(); }

  // --- P2P ---
  initHost() {
    this.gameState = 'hosting'; this.isHost = true; this.isMultiplayer = true; this.myFaction = 'player';
    this.peer = new Peer();
    this.peer.on('open', (id) => this.myPeerId = id);
    this.peer.on('connection', (c) => { this.conn = c; this.setupConnection(); this.startGame('player'); });
  }
  initJoin() {
    this.gameState = 'joining'; this.isHost = false; this.isMultiplayer = true; this.myFaction = 'enemy';
    this.peer = new Peer(); this.peer.on('open', (id) => this.myPeerId = id);
  }
  connectToHost() {
    if (!this.joinPeerId || !this.peer) return;
    this.conn = this.peer.connect(this.joinPeerId); this.setupConnection();
  }
  setupConnection() {
    this.conn.on('open', () => { if (!this.isHost) this.gameState = 'playing'; });
    this.conn.on('data', (data: any) => {
      if (this.isHost) {
        if (data.type === 'action') this.processClientAction(data.action);
      } else {
        if (data.type === 'state') { this.nodes = data.state.nodes; this.movements = data.state.movements; }
        else if (data.type === 'gameover') { this.gameState = 'gameover'; this.stopGame(); }
      }
    });
    this.conn.on('close', () => { alert("Conexión perdida."); this.goMenu(); });
  }
  processClientAction(a: any) {
    if (a.cmd === 'send') {
       const source = this.nodes.find(n => n.id === a.sourceId);
       const target = a.targetId ? this.nodes.find(n => n.id === a.targetId) : null;
       if (source && target) this.sendTroops(source, target, a.percentage);
       else if (source && !target) this.sendTroopsToPoint(source, a.targetX, a.targetY, a.percentage);
    } else if (a.cmd === 'upgrade') {
       const node = this.nodes.find(n => n.id === a.nodeId);
       if (node) this.upgradeNodeCore(node);
    }
  }

  // --- GAME START ---
  startGame(mode: 'player' | 'simulation' = 'player') {
    this.gameState = mode === 'simulation' ? 'simulation' : 'playing';
    this.isMultiplayer = this.conn !== null;
    this.myFaction = this.isHost || !this.isMultiplayer ? 'player' : 'enemy';

    let pOwner: any = mode === 'player' ? 'player' : 'ai_micro';
    let eOwner: any = mode === 'player' ? 'enemy' : 'ai_macro';

    this.nodes = [
      { id: 1, x: 800, y: 3200, troops: 5000, owner: pOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
      { id: 2, x: 3200, y: 800, troops: 5000, owner: eOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
      { id: 3, x: 2000, y: 2000, troops: 15000, owner: 'neutral', type: 'fortress', level: 2, capacity: 50000, pushX:0, pushY:0 },
      { id: 4, x: 800, y: 800, troops: 2000, owner: 'neutral', type: 'forge', level: 1, capacity: 15000, pushX:0, pushY:0 },
      { id: 5, x: 3200, y: 3200, troops: 2000, owner: 'neutral', type: 'forge', level: 1, capacity: 15000, pushX:0, pushY:0 },
      { id: 6, x: 2000, y: 800, troops: 3000, owner: 'neutral', type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
      { id: 7, x: 2000, y: 3200, troops: 3000, owner: 'neutral', type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 }
    ];

    this.movements = [];
    this.lastTick = performance.now();
    this.lastFrameTime = this.lastTick;
    this.lastMicroTick = this.lastTick;
    this.lastMacroTick = this.lastTick;
    this.lastSyncTick = this.lastTick;
    
    this.gameLoop = requestAnimationFrame((t) => this.tick(t));
  }

  stopGame() { cancelAnimationFrame(this.gameLoop); }

  formatTroops(amount: number): string {
    if (amount < 1000) return Math.floor(Math.max(0, amount)).toString();
    if (amount < 1000000) return (amount / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return (amount / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }

  // --- ENGINE TICK ---
  tick(time: number) {
    if (this.gameState !== 'playing' && this.gameState !== 'simulation') return;

    const elapsed = time - this.lastFrameTime;
    if (elapsed < this.frameInterval) {
      this.gameLoop = requestAnimationFrame((t) => this.tick(t));
      return;
    }
    
    let dt = elapsed / 1000;
    if (dt > 0.1) dt = 0.1; 
    
    this.lastFrameTime = time - (elapsed % this.frameInterval);
    this.lastTick = time;

    this.updateLogic(dt, time);
    this.renderCanvas();

    this.gameLoop = requestAnimationFrame((t) => this.tick(t));
  }

  updateLogic(dt: number, time: number) {
    if (!this.isMultiplayer || this.isHost) {
      // Logic
      this.nodes.forEach(n => {
        if (n.owner !== 'neutral') {
          let genRate = 200 * n.level; 
          if (n.type === 'forge') genRate *= 0.5;
          if (n.type === 'fortress') genRate *= 0.3;
          if (n.type === 'camp') genRate *= 0.0;
          n.troops += genRate * dt; 
          if (n.troops > n.capacity) n.troops -= (n.troops - n.capacity) * 0.1 * dt; 
        }

        n.pushX *= 0.85; n.pushY *= 0.85; 
        n.x = Math.max(60, Math.min(this.MAP_WIDTH - 60, n.x + n.pushX * dt));
        n.y = Math.max(60, Math.min(this.MAP_HEIGHT - 60, n.y + n.pushY * dt));
      });

      for (let i = this.movements.length - 1; i >= 0; i--) {
        const m = this.movements[i];
        if (!m.combating) {
          const speed = m.unitType === 'heavy' ? 150 : 350;
          m.progress += speed * dt;
          if (m.progress >= m.totalDistance - 50) {
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

      if (this.gameState === 'playing' && !this.isMultiplayer) this.runBasicEnemyAI();
      else if (this.gameState === 'simulation') this.runSimulationAI(time);

      this.checkWinCondition();

      if (this.isHost && time - this.lastSyncTick > 50) {
        this.lastSyncTick = time;
        if (this.conn && this.conn.open) this.conn.send({ type: 'state', state: { nodes: this.nodes, movements: this.movements } });
      }
    }
  }

  // --- RENDERING (PURE CANVAS) ---
  renderCanvas() {
    if (!this.ctx || !this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    const ctx = this.ctx;

    // Clear Background
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    // 1. Grid
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.05)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= this.MAP_WIDTH; x += 200) { ctx.moveTo(x, 0); ctx.lineTo(x, this.MAP_HEIGHT); }
    for (let y = 0; y <= this.MAP_HEIGHT; y += 200) { ctx.moveTo(0, y); ctx.lineTo(this.MAP_WIDTH, y); }
    ctx.stroke();

    // Map Bounds
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, this.MAP_WIDTH, this.MAP_HEIGHT);

    // 2. Territory (Frontlines - Fast Radial Gradients)
    ctx.globalCompositeOperation = 'lighter';
    this.nodes.forEach(n => {
      if (n.owner === 'neutral') return;
      const radius = 250 + (n.troops / n.capacity) * 300;
      const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, radius);
      grad.addColorStop(0, this.hexToRgba(FACTION_COLORS[n.owner], 0.2));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(n.x, n.y, radius, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';

    // 3. Drag Line
    if (this.isLineDragging && this.selectedNode) {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 8;
      ctx.setLineDash([20, 20]);
      ctx.beginPath();
      ctx.moveTo(this.selectedNode.x, this.selectedNode.y);
      ctx.lineTo(this.dragCurrentX, this.dragCurrentY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Reticle
      ctx.beginPath(); ctx.arc(this.dragCurrentX, this.dragCurrentY, 30, 0, Math.PI*2); ctx.stroke();
    }

    // 4. Swarms
    this.movements.forEach(m => {
      const cx = m.startX + ((m.targetX - m.startX) * (m.progress / m.totalDistance));
      const cy = m.startY + ((m.targetY - m.startY) * (m.progress / m.totalDistance));
      const color = FACTION_COLORS[m.owner];

      ctx.fillStyle = this.hexToRgba(color, 0.8);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      
      // Jitter if combat
      const jx = m.combating ? (Math.random() - 0.5) * 10 : 0;
      const jy = m.combating ? (Math.random() - 0.5) * 10 : 0;

      ctx.beginPath();
      if (m.unitType === 'heavy') {
         ctx.roundRect(cx - 35 + jx, cy - 35 + jy, 70, 70, 10);
      } else {
         ctx.arc(cx + jx, cy + jy, 30, 0, Math.PI * 2);
      }
      ctx.fill(); ctx.stroke();

      // Text
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px Orbitron';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
      ctx.fillText(this.formatTroops(m.amount), cx + jx, cy + jy);
      ctx.shadowBlur = 0;
    });

    // 5. Nodes
    this.nodes.forEach(n => {
      const color = FACTION_COLORS[n.owner];
      const isSelected = this.selectedNode?.id === n.id;
      
      // Jitter
      const jx = (n.pushX !== 0) ? (Math.random() - 0.5) * 5 : 0;
      const jy = (n.pushY !== 0) ? (Math.random() - 0.5) * 5 : 0;
      const nx = n.x + jx;
      const ny = n.y + jy;

      // Glow
      ctx.shadowColor = color;
      ctx.shadowBlur = isSelected ? 50 : 20;

      ctx.fillStyle = '#111';
      ctx.strokeStyle = isSelected ? '#fff' : color;
      ctx.lineWidth = isSelected ? 8 : 4;

      ctx.save();
      ctx.translate(nx, ny);

      ctx.beginPath();
      if (n.type === 'city') ctx.arc(0, 0, 60, 0, Math.PI * 2);
      else if (n.type === 'camp') { ctx.setLineDash([10, 10]); ctx.arc(0, 0, 50, 0, Math.PI * 2); }
      else if (n.type === 'forge') ctx.roundRect(-55, -55, 110, 110, 15);
      else if (n.type === 'fortress') { ctx.rotate(Math.PI / 4); ctx.roundRect(-60, -60, 120, 120, 20); }
      
      ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0; // Reset

      // Text
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 36px Orbitron';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 5;
      ctx.fillText(this.formatTroops(n.troops), nx, ny);

      // Warning
      if (n.troops > n.capacity) {
         ctx.fillStyle = '#ff1744';
         ctx.font = 'bold 24px Orbitron';
         ctx.fillText('CRÍTICO', nx, ny - 80);
      }
      ctx.shadowBlur = 0;
    });

    ctx.restore();
  }

  hexToRgba(hex: string, alpha: number) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // --- COMBAT & LOGIC ---
  createCamp(movement: TroopMovement) {
    this.nodes.push({
      id: Math.max(...this.nodes.map(n => n.id), 0) + 1,
      x: movement.targetX, y: movement.targetY,
      troops: movement.amount, owner: movement.owner,
      type: 'camp', level: 1, capacity: 10000, pushX: 0, pushY: 0
    });
  }

  processCombatTick(movement: TroopMovement, dt: number, index: number) {
    const target = this.nodes.find(n => n.id === movement.targetNodeId);
    if (!target) { this.createCamp(movement); this.movements.splice(index, 1); return; }

    const dx = target.x - movement.startX, dy = target.y - movement.startY;
    const len = Math.hypot(dx, dy);
    const dirX = len > 0 ? dx / len : 0, dirY = len > 0 ? dy / len : 0;

    if (target.owner === movement.owner) {
      const transferRate = 8000 * dt; 
      const amountToTransfer = Math.min(movement.amount, transferRate);
      target.troops += amountToTransfer; movement.amount -= amountToTransfer;
      if (movement.amount <= 0) this.movements.splice(index, 1);
    } else {
      let combatRate = 1200 * dt; 
      let damageToTarget = combatRate; let damageToSwarm = combatRate;

      if (movement.unitType === 'heavy') damageToTarget *= 2.0;
      if (target.type === 'fortress') damageToTarget *= 0.5;

      const pushForce = movement.unitType === 'heavy' ? 300 : 150;
      target.pushX += dirX * pushForce * dt; target.pushY += dirY * pushForce * dt;

      const actualDamageTarget = Math.min(target.troops, damageToTarget);
      const actualDamageSwarm = Math.min(movement.amount, damageToSwarm);

      target.troops -= actualDamageTarget; movement.amount -= actualDamageSwarm;

      if (target.troops <= 0) { target.owner = movement.owner; target.troops = movement.amount; this.movements.splice(index, 1); } 
      else if (movement.amount <= 0) { this.movements.splice(index, 1); }
    }
  }

  upgradeNodeCore(node: GameNode) {
    if (node.type === 'camp') return;
    const cost = 5000 * node.level; 
    if (node.troops >= cost && node.level < 5) { node.troops -= cost; node.level++; node.capacity += 20000; }
  }

  runBasicEnemyAI() {
    if (Math.random() < 0.005) { 
      const enemies = this.nodes.filter(n => n.owner === 'enemy');
      if (enemies.length > 0) {
        const source = enemies[Math.floor(Math.random() * enemies.length)];
        if (source.troops > 8000 * source.level && source.level < 3 && source.type !== 'camp') {
            source.troops -= 5000 * source.level; source.level++; source.capacity += 20000;
        } else if (source.troops > source.capacity * 0.6) {
          const targets = this.nodes.filter(n => n.id !== source.id);
          const target = targets[Math.floor(Math.random() * targets.length)];
          this.sendTroops(source, target, 0.5);
        }
      }
    }
  }

  runSimulationAI(time: number) {
    if (time - this.lastMicroTick > 1500) { 
      this.lastMicroTick = time;
      this.nodes.filter(n => n.owner === 'ai_micro').forEach(source => {
        if (source.troops > 2000) {
          let closest: GameNode | null = null; let minD = Infinity;
          this.nodes.filter(n => n.owner !== 'ai_micro').forEach(target => {
             const d = Math.hypot(target.x - source.x, target.y - source.y);
             if (d < minD) { minD = d; closest = target; }
          });
          if (closest) this.sendTroops(source, closest, 0.3);
        }
      });
    }

    if (time - this.lastMacroTick > 6000) { 
      this.lastMacroTick = time;
      const macroNodes = this.nodes.filter(n => n.owner === 'ai_macro');
      macroNodes.forEach(n => { if (n.troops > 8000 * n.level && n.level < 4 && n.type !== 'camp') { n.troops -= 5000 * n.level; n.level++; n.capacity += 20000; } });
      let totalTroops = macroNodes.reduce((acc, n) => acc + n.troops, 0);
      if (totalTroops > 40000) {
        let biggestThreat = this.nodes.filter(n => n.owner !== 'ai_macro' && n.owner !== 'neutral').sort((a,b) => b.troops - a.troops)[0];
        if (!biggestThreat) biggestThreat = this.nodes.filter(n => n.owner === 'neutral').sort((a,b) => b.troops - a.troops)[0];
        if (biggestThreat) macroNodes.forEach(source => { if (source.troops > source.capacity * 0.4) this.sendTroops(source, biggestThreat, 1.0); });
      }
    }
  }

  checkWinCondition() {
    if (this.gameState === 'playing') {
      const hasPlayer = this.nodes.some(n => n.owner === 'player');
      const hasEnemy = this.nodes.some(n => n.owner === 'enemy');
      if (!hasPlayer || !hasEnemy) { this.gameState = 'gameover'; if (this.isHost && this.conn) this.conn.send({ type: 'gameover' }); this.stopGame(); }
    } else if (this.gameState === 'simulation') {
      const hasMicro = this.nodes.some(n => n.owner === 'ai_micro');
      const hasMacro = this.nodes.some(n => n.owner === 'ai_macro');
      if (!hasMicro || !hasMacro) { this.gameState = 'gameover'; this.stopGame(); }
    }
  }

  // --- INPUT (CANVAS) ---
  getLogicalCoord(clientX: number, clientY: number) { return { x: (clientX - this.panX) / this.scale, y: (clientY - this.panY) / this.scale }; }

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
      // Check if upgrade tapped (bottom 40px of node)
      if (logical.y > hitNode.y + 20 && hitNode.type !== 'camp' && hitNode.level < 5) {
         this.upgradeNode(hitNode);
      } else {
         this.selectedNode = hitNode; this.isLineDragging = true; this.dragCurrentX = logical.x; this.dragCurrentY = logical.y;
      }
    } else {
      this.isPanning = true; this.lastTouchX = clientX; this.lastTouchY = clientY;
    }
  }

  onTouchMove(e: TouchEvent | MouseEvent) {
    if (e instanceof TouchEvent && e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const newScale = this.initialScale * (dist / this.initialPinchDistance);
      this.scale = Math.max(0.15, Math.min(newScale, 2.5)); return;
    }
    const clientX = e instanceof TouchEvent ? e.touches[0].clientX : e.clientX;
    const clientY = e instanceof TouchEvent ? e.touches[0].clientY : e.clientY;
    if (this.isLineDragging && this.selectedNode) {
      const logical = this.getLogicalCoord(clientX, clientY);
      this.dragCurrentX = logical.x; this.dragCurrentY = logical.y;
    } else if (this.isPanning) {
      this.panX += clientX - this.lastTouchX; this.panY += clientY - this.lastTouchY;
      this.lastTouchX = clientX; this.lastTouchY = clientY;
    }
  }

  onTouchEnd(e: TouchEvent | MouseEvent) {
    if (this.isLineDragging && this.selectedNode) {
      const targetNode = this.getNodeAtPosition(this.dragCurrentX, this.dragCurrentY);
      if (this.isMultiplayer && !this.isHost) {
         this.conn.send({ type: 'action', action: { cmd: 'send', sourceId: this.selectedNode.id, targetId: targetNode?.id || null, targetX: this.dragCurrentX, targetY: this.dragCurrentY, percentage: this.sendPercentage }});
      } else {
         if (targetNode && targetNode.id !== this.selectedNode.id) this.sendTroops(this.selectedNode, targetNode, this.sendPercentage);
         else if (!targetNode) this.sendTroopsToPoint(this.selectedNode, this.dragCurrentX, this.dragCurrentY, this.sendPercentage);
      }
    }
    this.isLineDragging = false; this.isPanning = false; this.selectedNode = null;
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const zoomFactor = Math.exp((e.deltaY < 0 ? 1 : -1) * 0.1);
    const newScale = Math.max(0.15, Math.min(this.scale * zoomFactor, 2.5));
    this.panX = e.clientX - (e.clientX - this.panX) * (newScale / this.scale);
    this.panY = e.clientY - (e.clientY - this.panY) * (newScale / this.scale);
    this.scale = newScale;
  }

  getNodeAtPosition(lx: number, ly: number): GameNode | null {
    for (const n of this.nodes) if (Math.hypot(n.x - lx, n.y - ly) < 60) return n; return null;
  }

  sendTroops(source: GameNode, target: GameNode, percentage: number) { this.createMovement(source, target.x, target.y, percentage, target.id); }
  sendTroopsToPoint(source: GameNode, targetX: number, targetY: number, percentage: number) { this.createMovement(source, targetX, targetY, percentage, null); }
  createMovement(source: GameNode, targetX: number, targetY: number, percentage: number, targetId: number | null) {
    const amount = Math.floor(source.troops * percentage); if (amount <= 0) return;
    source.troops -= amount;
    this.movements.push({ id: this.movementIdCounter++, startX: source.x, startY: source.y, targetX, targetY, amount, owner: source.owner, unitType: source.type === 'forge' ? 'heavy' : 'light', progress: 0, totalDistance: Math.hypot(targetX - source.x, targetY - source.y), targetNodeId: targetId, combating: false });
  }

  upgradeNode(node: GameNode) {
    if (this.isMultiplayer && !this.isHost) this.conn.send({ type: 'action', action: { cmd: 'upgrade', nodeId: node.id }});
    else this.upgradeNodeCore(node);
  }

  copyPeerId() { navigator.clipboard.writeText(this.myPeerId); }
  goMenu() { this.gameState = 'menu'; if(this.peer) this.peer.destroy(); this.peer = null; this.conn = null; }
  getWinner(): string { return this.gameState === 'playing' || this.gameState === 'gameover' ? (this.nodes.some(n => n.owner === this.myFaction) ? '¡Victoria!' : 'Derrota') : 'Fin'; }
}