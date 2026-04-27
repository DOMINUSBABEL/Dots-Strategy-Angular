import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit, HostListener } from '@angular/core';
import { trigger, style, animate, transition } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Peer from 'peerjs';

export type NodeType = 'city' | 'fortress' | 'forge' | 'camp';
export type UnitType = 'light' | 'heavy';

export interface GameNode {
  id: number; x: number; y: number; troops: number;
  owner: 'player' | 'enemy' | 'neutral' | 'ai_macro' | 'ai_micro';
  type: NodeType; level: number; capacity: number;
  pushX: number; pushY: number;
}

export interface Flow {
  id: number; sourceId: number; targetId: number | null;
  targetX: number; targetY: number; totalTroops: number; troopsSent: number;
  owner: 'player' | 'enemy' | 'neutral' | 'ai_macro' | 'ai_micro';
  unitType: UnitType; fractionalAccumulator: number; troopsPerDot: number; drainRate: number;
}

export interface Dot {
  id: number; x: number; y: number; targetId: number | null;
  targetX: number; targetY: number; owner: string; troops: number;
  unitType: UnitType; flowId: number;
}

const FACTION_COLORS: Record<string, string> = {
  'player': '#3498db', 'enemy': '#e74c3c', 'ai_micro': '#9b59b6', 'ai_macro': '#e67e22', 'neutral': '#7f8c8d'
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  animations: [
    trigger('splashFade', [transition(':leave', [animate('0.5s ease-in', style({ opacity: 0 }))])]),
    trigger('uiSlideUp', [transition(':enter', [style({ opacity: 0, transform: 'translateY(10px)' }), animate('0.2s ease-out', style({ opacity: 1, transform: 'translateY(0)' }))])])
  ]
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  showSplash = true;
  gameState: 'menu' | 'playing' | 'gameover' | 'simulation' | 'hosting' | 'joining' | 'settings' = 'menu';
  
  MAP_WIDTH = 4000; MAP_HEIGHT = 4000;
  mapType: string = 'standard';

  nodes: GameNode[] = []; flows: Flow[] = []; dots: Dot[] = [];
  flowIdCounter = 0; dotIdCounter = 0;
  
  selectedNode: GameNode | null = null;
  dragCurrentX = 0; dragCurrentY = 0; isLineDragging = false;
  sendPercentage: number = 0.5;

  gameLoop: any;
  lastTick = 0; lastFrameTime = 0;
  lastMicroTick = 0; lastMacroTick = 0; lastSyncTick = 0;

  scale = 0.5; panX = 0; panY = 0;
  isPanning = false; lastTouchX = 0; lastTouchY = 0;
  initialPinchDistance = 0; initialScale = 1;

  targetFPS = 60; frameInterval = 1000 / 60;
  resolutionScale = 1.0; dpr = 1;

  peer: Peer | null = null; conn: any = null;
  myPeerId: string = ''; joinPeerId: string = '';
  isHost = false; isMultiplayer = false;
  myFaction: 'player' | 'enemy' = 'player';

  @ViewChild('gameCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  ctx!: CanvasRenderingContext2D | null;

  ngOnInit() {
    this.autoDetectPerformance();
    setTimeout(() => { this.showSplash = false; }, 2000);
  }

  ngAfterViewInit() { this.initCanvas(); }
  @HostListener('window:resize') onResize() { this.initCanvas(); }

  initCanvas() {
    if (!this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    this.dpr = (window.devicePixelRatio || 1) * this.resolutionScale;
    canvas.width = window.innerWidth * this.dpr; canvas.height = window.innerHeight * this.dpr;
    canvas.style.width = window.innerWidth + 'px'; canvas.style.height = window.innerHeight + 'px';
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (this.nodes.length === 0) this.centerCamera();
  }

  centerCamera() {
    this.panX = (window.innerWidth / 2) - (this.MAP_WIDTH * this.scale / 2);
    this.panY = (window.innerHeight / 2) - (this.MAP_HEIGHT * this.scale / 2);
  }

  autoDetectPerformance() {
    if (window.innerWidth < 800) { this.resolutionScale = 0.75; this.targetFPS = 60; } 
    else { this.resolutionScale = 1.0; this.targetFPS = 120; }
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
    this.peer = new Peer(); this.peer.on('open', (id) => this.myPeerId = id);
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
        if (data.type === 'state') { this.nodes = data.state.nodes; this.flows = data.state.flows; }
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
    } else if (a.cmd === 'cancel_flow') {
       const flow = this.flows.find(f => f.id === a.flowId);
       if (flow) this.cancelFlowCore(flow);
    }
  }

  // --- GAME START ---
  generateMap(mode: 'player' | 'simulation') {
    const types = ['standard', 'chokepoint', 'scattered', 'hexagon', 'duel', 'crossfire'];
    this.mapType = types[Math.floor(Math.random() * types.length)];
    let pOwner: any = mode === 'player' ? 'player' : 'ai_micro';
    let eOwner: any = mode === 'player' ? 'enemy' : 'ai_macro';
    this.nodes = [];

    switch(this.mapType) {
      case 'hexagon':
        this.nodes = [
          { id: 1, x: 2000, y: 3500, troops: 5000, owner: pOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 2, x: 2000, y: 500, troops: 5000, owner: eOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 3, x: 2000, y: 2000, troops: 20000, owner: 'neutral', type: 'fortress', level: 3, capacity: 100000, pushX:0, pushY:0 },
          { id: 4, x: 1000, y: 1200, troops: 3000, owner: 'neutral', type: 'forge', level: 1, capacity: 15000, pushX:0, pushY:0 },
          { id: 5, x: 3000, y: 1200, troops: 3000, owner: 'neutral', type: 'forge', level: 1, capacity: 15000, pushX:0, pushY:0 },
          { id: 6, x: 1000, y: 2800, troops: 3000, owner: 'neutral', type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 7, x: 3000, y: 2800, troops: 3000, owner: 'neutral', type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 }
        ]; break;
      case 'duel':
        this.nodes = [
          { id: 1, x: 500, y: 2000, troops: 15000, owner: pOwner, type: 'fortress', level: 2, capacity: 50000, pushX:0, pushY:0 },
          { id: 2, x: 3500, y: 2000, troops: 15000, owner: eOwner, type: 'fortress', level: 2, capacity: 50000, pushX:0, pushY:0 },
          { id: 3, x: 2000, y: 1000, troops: 5000, owner: 'neutral', type: 'forge', level: 1, capacity: 15000, pushX:0, pushY:0 },
          { id: 4, x: 2000, y: 3000, troops: 5000, owner: 'neutral', type: 'forge', level: 1, capacity: 15000, pushX:0, pushY:0 },
          { id: 5, x: 2000, y: 2000, troops: 8000, owner: 'neutral', type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 }
        ]; break;
      case 'crossfire':
        this.nodes = [
          { id: 1, x: 800, y: 800, troops: 6000, owner: pOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 2, x: 3200, y: 3200, troops: 6000, owner: pOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 3, x: 3200, y: 800, troops: 6000, owner: eOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 4, x: 800, y: 3200, troops: 6000, owner: eOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 5, x: 2000, y: 2000, troops: 20000, owner: 'neutral', type: 'fortress', level: 3, capacity: 80000, pushX:0, pushY:0 }
        ]; break;
      case 'chokepoint':
        this.nodes = [
          { id: 1, x: 500, y: 2000, troops: 5000, owner: pOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 2, x: 3500, y: 2000, troops: 5000, owner: eOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 3, x: 2000, y: 2000, troops: 15000, owner: 'neutral', type: 'fortress', level: 3, capacity: 80000, pushX:0, pushY:0 },
          { id: 4, x: 1200, y: 1000, troops: 3000, owner: 'neutral', type: 'forge', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 5, x: 1200, y: 3000, troops: 3000, owner: 'neutral', type: 'forge', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 6, x: 2800, y: 1000, troops: 3000, owner: 'neutral', type: 'forge', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 7, x: 2800, y: 3000, troops: 3000, owner: 'neutral', type: 'forge', level: 1, capacity: 20000, pushX:0, pushY:0 }
        ]; break;
      case 'scattered':
        this.nodes = [
          { id: 1, x: 400, y: 400, troops: 5000, owner: pOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 2, x: 3600, y: 3600, troops: 5000, owner: eOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 3, x: 1000, y: 3000, troops: 3000, owner: 'neutral', type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 4, x: 3000, y: 1000, troops: 3000, owner: 'neutral', type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 5, x: 2000, y: 1500, troops: 5000, owner: 'neutral', type: 'fortress', level: 1, capacity: 30000, pushX:0, pushY:0 },
          { id: 6, x: 2000, y: 2500, troops: 5000, owner: 'neutral', type: 'fortress', level: 1, capacity: 30000, pushX:0, pushY:0 },
          { id: 7, x: 1500, y: 2000, troops: 2000, owner: 'neutral', type: 'forge', level: 1, capacity: 15000, pushX:0, pushY:0 },
          { id: 8, x: 2500, y: 2000, troops: 2000, owner: 'neutral', type: 'forge', level: 1, capacity: 15000, pushX:0, pushY:0 }
        ]; break;
      default:
        this.nodes = [
          { id: 1, x: 800, y: 3200, troops: 5000, owner: pOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 2, x: 3200, y: 800, troops: 5000, owner: eOwner, type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 3, x: 2000, y: 2000, troops: 15000, owner: 'neutral', type: 'fortress', level: 2, capacity: 50000, pushX:0, pushY:0 },
          { id: 4, x: 800, y: 800, troops: 2000, owner: 'neutral', type: 'forge', level: 1, capacity: 15000, pushX:0, pushY:0 },
          { id: 5, x: 3200, y: 3200, troops: 2000, owner: 'neutral', type: 'forge', level: 1, capacity: 15000, pushX:0, pushY:0 },
          { id: 6, x: 2000, y: 800, troops: 3000, owner: 'neutral', type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 },
          { id: 7, x: 2000, y: 3200, troops: 3000, owner: 'neutral', type: 'city', level: 1, capacity: 20000, pushX:0, pushY:0 }
        ]; break;
    }
  }

  startGame(mode: 'player' | 'simulation' = 'player') {
    this.gameState = mode === 'simulation' ? 'simulation' : 'playing';
    this.isMultiplayer = this.conn !== null;
    this.myFaction = this.isHost || !this.isMultiplayer ? 'player' : 'enemy';

    this.generateMap(mode);

    this.flows = []; this.dots = [];
    this.lastTick = performance.now(); this.lastFrameTime = this.lastTick;
    this.lastMicroTick = this.lastTick; this.lastMacroTick = this.lastTick; this.lastSyncTick = this.lastTick;
    this.centerCamera();
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
    if (elapsed < this.frameInterval) { this.gameLoop = requestAnimationFrame((t) => this.tick(t)); return; }
    
    let dt = elapsed / 1000; if (dt > 0.1) dt = 0.1; 
    
    this.lastFrameTime = time - (elapsed % this.frameInterval);
    this.lastTick = time;

    this.updateLogic(dt, time);
    this.renderCanvas();

    this.gameLoop = requestAnimationFrame((t) => this.tick(t));
  }

  updateLogic(dt: number, time: number) {
    if (!this.isMultiplayer || this.isHost) {
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
    }

    for (let i = this.flows.length - 1; i >= 0; i--) {
      const flow = this.flows[i];
      const source = this.nodes.find(n => n.id === flow.sourceId);
      if (!source || source.owner !== flow.owner) { this.flows.splice(i, 1); continue; }

      const remaining = flow.totalTroops - flow.troopsSent;
      if (remaining <= 0) { this.flows.splice(i, 1); continue; }

      let toSend = flow.drainRate * dt;
      if (toSend > remaining) toSend = remaining;

      flow.troopsSent += toSend;
      flow.fractionalAccumulator += toSend;

      while (flow.fractionalAccumulator >= flow.troopsPerDot) {
         flow.fractionalAccumulator -= flow.troopsPerDot;
         const startX = source ? source.x : flow.targetX;
         const startY = source ? source.y : flow.targetY;
         const angle = Math.random() * Math.PI * 2; const offset = Math.random() * 25;
         
         this.dots.push({
           id: this.dotIdCounter++,
           x: startX + Math.cos(angle)*offset, y: startY + Math.sin(angle)*offset,
           targetId: flow.targetId, targetX: flow.targetX, targetY: flow.targetY,
           owner: flow.owner, troops: flow.troopsPerDot, unitType: flow.unitType, flowId: flow.id
         });
      }
    }

    for (let i = this.dots.length - 1; i >= 0; i--) {
      const dot = this.dots[i];
      if (dot.troops <= 0) continue; 
      
      let targetNode = dot.targetId ? this.nodes.find(n => n.id === dot.targetId) : null;
      if (targetNode) { dot.targetX = targetNode.x; dot.targetY = targetNode.y; }

      const dx = dot.targetX - dot.x; const dy = dot.targetY - dot.y;
      const dist = Math.hypot(dx, dy);
      const speed = (dot.unitType === 'heavy' ? 150 : 350) * dt;

      if (dist <= speed || dist < 20) {
         if (dot.targetId === null) {
           targetNode = this.createCamp(dot);
           this.dots.forEach(d => { if (d.flowId === dot.flowId) d.targetId = targetNode!.id; });
           this.flows.forEach(f => { if (f.id === dot.flowId) f.targetId = targetNode!.id; });
         } else if (targetNode) { this.processDotCombat(dot, targetNode); }
         dot.troops = 0; 
      } else {
         dot.x += (dx / dist) * speed; dot.y += (dy / dist) * speed;
      }
    }

    this.processDotCollisions();
    this.dots = this.dots.filter(d => d.troops > 0);

    if (!this.isMultiplayer || this.isHost) {
      if (this.gameState === 'playing' && !this.isMultiplayer) this.runBasicEnemyAI();
      else if (this.gameState === 'simulation') this.runSimulationAI(time);
      this.checkWinCondition();

      if (this.isHost && time - this.lastSyncTick > 50) {
        this.lastSyncTick = time;
        if (this.conn && this.conn.open) this.conn.send({ type: 'state', state: { nodes: this.nodes, flows: this.flows } });
      }
    }
  }

  // --- RENDERING OPTIMIZADO (BATCHING) ---
  renderCanvas() {
    if (!this.ctx || !this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    const ctx = this.ctx;

    ctx.fillStyle = '#12141a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    // Faint connection lines & FLOW BADGES
    ctx.lineWidth = 1;
    this.flows.forEach(f => {
       const source = this.nodes.find(n => n.id === f.sourceId);
       if (source) {
          ctx.strokeStyle = this.hexToRgba(FACTION_COLORS[f.owner], 0.2);
          ctx.beginPath(); ctx.moveTo(source.x, source.y); ctx.lineTo(f.targetX, f.targetY); ctx.stroke();
          
          // Badge interaction
          const midX = source.x + (f.targetX - source.x) * 0.5;
          const midY = source.y + (f.targetY - source.y) * 0.5;
          const remaining = f.totalTroops - f.troopsSent;
          
          if (remaining > 0) {
             ctx.fillStyle = '#222';
             ctx.beginPath(); ctx.roundRect(midX - 30, midY - 12, 60, 24, 12); ctx.fill();
             ctx.fillStyle = FACTION_COLORS[f.owner];
             ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
             ctx.fillText('x' + this.formatTroops(remaining), midX, midY);
          }
       }
    });

    // Batch Rendering for Dots
    const dotsByColor: Record<string, Dot[]> = {};
    for (const owner in FACTION_COLORS) dotsByColor[owner] = [];
    this.dots.forEach(d => dotsByColor[d.owner].push(d));

    for (const owner in FACTION_COLORS) {
       const dots = dotsByColor[owner];
       if (dots.length === 0) continue;
       
       ctx.fillStyle = FACTION_COLORS[owner];
       ctx.beginPath();
       dots.forEach(d => {
         if (d.unitType === 'heavy') {
            ctx.rect(d.x - 4, d.y - 4, 8, 8);
         } else {
            ctx.moveTo(d.x + 4, d.y);
            ctx.arc(d.x, d.y, 4, 0, Math.PI*2);
         }
       });
       ctx.fill();
    }

    // Drag Line
    if (this.isLineDragging && this.selectedNode) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([10, 10]);
      ctx.beginPath(); ctx.moveTo(this.selectedNode.x, this.selectedNode.y); ctx.lineTo(this.dragCurrentX, this.dragCurrentY); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.arc(this.dragCurrentX, this.dragCurrentY, 15, 0, Math.PI*2); ctx.stroke();
    }

    // Nodes
    this.nodes.forEach(n => {
      const color = FACTION_COLORS[n.owner] || '#555';
      const isSelected = this.selectedNode?.id === n.id;
      const nx = n.x + ((n.pushX !== 0) ? (Math.random() - 0.5) * 4 : 0);
      const ny = n.y + ((n.pushY !== 0) ? (Math.random() - 0.5) * 4 : 0);

      ctx.fillStyle = color;
      if (isSelected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(nx, ny, 50, 0, Math.PI*2); ctx.stroke(); }

      ctx.save(); ctx.translate(nx, ny);
      ctx.beginPath();
      if (n.type === 'city') ctx.arc(0, 0, 40, 0, Math.PI * 2);
      else if (n.type === 'camp') { ctx.setLineDash([5, 5]); ctx.arc(0, 0, 30, 0, Math.PI * 2); }
      else if (n.type === 'forge') ctx.roundRect(-35, -35, 70, 70, 8);
      else if (n.type === 'fortress') { ctx.rotate(Math.PI / 4); ctx.roundRect(-35, -35, 70, 70, 12); }
      ctx.fill(); ctx.restore(); ctx.setLineDash([]);

      ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.formatTroops(n.troops), nx, ny);

      if (n.owner === this.myFaction && n.level < 5 && n.type !== 'camp') {
         ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '12px Arial, sans-serif'; ctx.fillText(`Lvl ${n.level}`, nx, ny + 25);
      }
      if (n.troops > n.capacity) {
         ctx.fillStyle = '#ff1744'; ctx.font = 'bold 12px Arial'; ctx.fillText('FULL', nx, ny - 50);
      }
    });

    ctx.restore();
  }

  hexToRgba(hex: string, alpha: number) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // --- COMBAT & LOGIC ---
  createCamp(dot: Dot | Flow): GameNode {
    const newNode: GameNode = {
      id: Math.max(...this.nodes.map(n => n.id), 0) + 1,
      x: dot.targetX, y: dot.targetY,
      troops: 0, owner: dot.owner as any,
      type: 'camp', level: 1, capacity: 10000, pushX: 0, pushY: 0
    };
    this.nodes.push(newNode);
    return newNode;
  }

  processDotCombat(dot: Dot, target: GameNode) {
    if (this.isMultiplayer && !this.isHost) return;

    if (target.owner === dot.owner) { target.troops += dot.troops; } 
    else {
      let damage = dot.troops * (dot.unitType === 'heavy' ? 2 : 1);
      if (target.type === 'fortress') damage *= 0.5;

      const pushForce = dot.unitType === 'heavy' ? 1.5 : 0.5;
      const dx = target.x - dot.x; const dy = target.y - dot.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0) { target.pushX += (dx / dist) * pushForce; target.pushY += (dy / dist) * pushForce; }

      target.troops -= damage;
      if (target.troops < 0) { target.owner = dot.owner as any; target.troops = Math.abs(target.troops); }
    }
  }

  processDotCollisions() {
    for (let i = 0; i < this.dots.length; i++) {
      const a = this.dots[i]; if (a.troops <= 0) continue;
      for (let j = i + 1; j < this.dots.length; j++) {
        const b = this.dots[j]; if (b.troops <= 0) continue;
        if (a.owner === b.owner) continue;

        const dx = a.x - b.x; const dy = a.y - b.y;
        if (dx*dx + dy*dy < 100) { 
           const dmgA = b.troops * (b.unitType === 'heavy' ? 2 : 1);
           const dmgB = a.troops * (a.unitType === 'heavy' ? 2 : 1);
           a.troops -= dmgA; b.troops -= dmgB;
        }
      }
    }
  }

  upgradeNode(node: GameNode) {
    if (this.isMultiplayer && !this.isHost) this.conn.send({ type: 'action', action: { cmd: 'upgrade', nodeId: node.id }});
    else this.upgradeNodeCore(node);
  }

  upgradeNodeCore(node: GameNode) {
    if (node.type === 'camp') return;
    const cost = 5000 * node.level; 
    if (node.troops >= cost && node.level < 5) { node.troops -= cost; node.level++; node.capacity += 20000; }
  }

  cancelFlowCore(flow: Flow) {
    const idx = this.flows.findIndex(f => f.id === flow.id);
    if (idx === -1) return;
    this.flows.splice(idx, 1);
    
    const source = this.nodes.find(n => n.id === flow.sourceId);
    if (!source) return;
    const midX = source.x + (flow.targetX - source.x) * 0.5;
    const midY = source.y + (flow.targetY - source.y) * 0.5;
    const remaining = flow.totalTroops - flow.troopsSent;
    
    if (remaining > 0) {
      const camp = this.createCamp({ targetX: midX, targetY: midY, owner: flow.owner } as any);
      camp.troops = remaining;
      this.dots.forEach(d => { if (d.flowId === flow.id) { d.targetId = camp.id; d.targetX = midX; d.targetY = midY; } });
    }
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

  // --- INPUT ---
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
      if (logical.y > hitNode.y + 20 && hitNode.type !== 'camp' && hitNode.level < 5) {
         this.upgradeNode(hitNode);
      } else {
         this.selectedNode = hitNode; this.isLineDragging = true; this.dragCurrentX = logical.x; this.dragCurrentY = logical.y;
      }
      return;
    } 

    // Check hit on Flow Badges (Cancellation)
    let hitFlow: Flow | null = null;
    for (const f of this.flows) {
      if (f.owner !== this.myFaction) continue;
      const source = this.nodes.find(n => n.id === f.sourceId);
      if (!source) continue;
      const midX = source.x + (f.targetX - source.x) * 0.5;
      const midY = source.y + (f.targetY - source.y) * 0.5;
      if (Math.hypot(midX - logical.x, midY - logical.y) < 35) { hitFlow = f; break; }
    }

    if (hitFlow) {
      if (this.isMultiplayer && !this.isHost) this.conn.send({ type: 'action', action: { cmd: 'cancel_flow', flowId: hitFlow.id }});
      else this.cancelFlowCore(hitFlow);
      return;
    }

    this.isPanning = true; this.lastTouchX = clientX; this.lastTouchY = clientY;
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
    for (const n of this.nodes) if (Math.hypot(n.x - lx, n.y - ly) < 45) return n; return null;
  }

  sendTroops(source: GameNode, target: GameNode, percentage: number) { this.createFlow(source, target.x, target.y, percentage, target.id); }
  sendTroopsToPoint(source: GameNode, targetX: number, targetY: number, percentage: number) { this.createFlow(source, targetX, targetY, percentage, null); }
  
  createFlow(source: GameNode, targetX: number, targetY: number, percentage: number, targetId: number | null) {
    const amount = Math.floor(source.troops * percentage); if (amount <= 0) return;
    source.troops -= amount;
    const drainRate = amount / 1.5; 
    const troopsPerDot = Math.max(1, amount / 30); 
    
    this.flows.push({
      id: this.flowIdCounter++,
      sourceId: source.id, targetId,
      targetX, targetY, totalTroops: amount, troopsSent: 0,
      owner: source.owner, unitType: source.type === 'forge' ? 'heavy' : 'light',
      fractionalAccumulator: 0, troopsPerDot, drainRate
    });
  }

  copyPeerId() { navigator.clipboard.writeText(this.myPeerId); }
  goMenu() { this.gameState = 'menu'; if(this.peer) this.peer.destroy(); this.peer = null; this.conn = null; }
  getWinner(): string { return this.gameState === 'playing' || this.gameState === 'gameover' ? (this.nodes.some(n => n.owner === this.myFaction) ? '¡Victoria!' : 'Derrota') : 'Fin'; }
}