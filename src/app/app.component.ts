import { Component, OnInit, OnDestroy } from '@angular/core';
import { trigger, state, style, animate, transition, keyframes } from '@angular/animations';
import { CommonModule } from '@angular/common';

interface GameNode {
  id: number;
  x: number;
  y: number;
  troops: number;
  owner: 'player' | 'enemy' | 'neutral';
}

interface TroopMovement {
  id: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  amount: number;
  owner: 'player' | 'enemy' | 'neutral';
  progress: number; // 0 to 1
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
  gameState: 'menu' | 'playing' | 'gameover' = 'menu';
  nodes: GameNode[] = [];
  movements: TroopMovement[] = [];
  movementIdCounter = 0;
  
  selectedNode: GameNode | null = null;
  dragCurrentX = 0;
  dragCurrentY = 0;
  isDragging = false;

  gameLoop: any;
  lastTick = 0;

  ngOnInit() {
    setTimeout(() => {
      this.showSplash = false;
    }, 3000);
  }

  ngOnDestroy() {
    this.stopGame();
  }

  startGame() {
    this.gameState = 'playing';
    this.nodes = [
      { id: 1, x: 20, y: 80, troops: 50000, owner: 'player' },
      { id: 2, x: 80, y: 20, troops: 50000, owner: 'enemy' },
      { id: 3, x: 50, y: 50, troops: 10000, owner: 'neutral' },
      { id: 4, x: 20, y: 20, troops: 20000, owner: 'neutral' },
      { id: 5, x: 80, y: 80, troops: 20000, owner: 'neutral' }
    ];
    this.movements = [];
    this.lastTick = performance.now();
    this.gameLoop = requestAnimationFrame((t) => this.tick(t));
  }

  stopGame() {
    cancelAnimationFrame(this.gameLoop);
  }

  formatTroops(amount: number): string {
    if (amount < 1000) return amount.toString();
    if (amount < 1000000) return (amount / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return (amount / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }

  tick(time: number) {
    const dt = (time - this.lastTick) / 1000;
    this.lastTick = time;

    // Generate troops
    this.nodes.forEach(n => {
      if (n.owner !== 'neutral') {
        n.troops += 5000 * dt; // 5K troops per second
      }
    });

    // Move troops
    for (let i = this.movements.length - 1; i >= 0; i--) {
      const m = this.movements[i];
      m.progress += 0.5 * dt; // 2 seconds to reach target
      if (m.progress >= 1) {
        this.resolveCombat(m);
        this.movements.splice(i, 1);
      }
    }

    // Basic Enemy AI
    if (Math.random() < 0.01) { // roughly 1 action per second
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

    this.checkWinCondition();

    if (this.gameState === 'playing') {
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

  checkWinCondition() {
    const hasPlayer = this.nodes.some(n => n.owner === 'player');
    const hasEnemy = this.nodes.some(n => n.owner === 'enemy');

    if (!hasPlayer || !hasEnemy) {
      this.gameState = 'gameover';
      this.stopGame();
    }
  }

  // Touch handlers
  onTouchStart(e: TouchEvent | MouseEvent, node: GameNode) {
    if (node.owner !== 'player') return;
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
      this.sendTroops(this.selectedNode, targetNode);
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
      // 40px radius check
      if (Math.hypot(nx - x, ny - y) < 40) {
        return n;
      }
    }
    return null;
  }

  sendTroops(source: GameNode, target: GameNode) {
    const amount = Math.floor(source.troops / 2);
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
    if (this.nodes.some(n => n.owner === 'player')) return '¡Victoria!';
    return 'Derrota...';
  }
}
