import { useEffect, useRef, useState } from 'react';
import '../styles/AnimatedBackground.css';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  targetOpacity: number;
}

interface Connection {
  p1: number;
  p2: number;
  opacity: number;
  targetOpacity: number;
  age: number;
}

const PARTICLE_COUNT = 40;
const CONNECTION_DISTANCE = 180;
const RESPECTS_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const connectionsRef = useRef<Connection[]>([]);
  const animationIdRef = useRef<number>();
  const [ripples, setRipples] = useState<Array<{ x: number; y: number; age: number; maxAge: number }>>([]);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Initialize particles
  useEffect(() => {
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.5 + 0.1,
        targetOpacity: Math.random() * 0.5 + 0.1,
      });
    }
    particlesRef.current = particles;
  }, []);

  // Canvas animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const animate = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const particles = particlesRef.current;
      const connections = connectionsRef.current;

      // Update and draw particles
      particles.forEach((p, i) => {
        // Update position
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around screen
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        // Smoothly transition opacity
        p.opacity += (p.targetOpacity - p.opacity) * 0.02;

        // Occasionally change target opacity
        if (Math.random() < 0.001) {
          p.targetOpacity = Math.random() * 0.5 + 0.05;
        }

        // Draw particle with glow
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
        gradient.addColorStop(0, `rgba(100, 180, 255, ${p.opacity * 0.8})`);
        gradient.addColorStop(1, `rgba(100, 180, 255, 0)`);

        ctx.fillStyle = gradient;
        ctx.fillRect(p.x - p.size * 2, p.y - p.size * 2, p.size * 4, p.size * 4);

        // Core
        ctx.fillStyle = `rgba(150, 200, 255, ${p.opacity})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Update connections
      connectionsRef.current = connections
        .map((conn) => {
          conn.age += 1;
          conn.opacity += (conn.targetOpacity - conn.opacity) * 0.05;
          return conn;
        })
        .filter((conn) => conn.age < 200);

      // Create new connections randomly
      if (Math.random() < 0.02 && connections.length < 15) {
        const p1 = Math.floor(Math.random() * particles.length);
        const p2 = Math.floor(Math.random() * particles.length);

        if (p1 !== p2) {
          const dx = particles[p2].x - particles[p1].x;
          const dy = particles[p2].y - particles[p1].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < CONNECTION_DISTANCE) {
            connections.push({
              p1,
              p2,
              opacity: 0,
              targetOpacity: (1 - dist / CONNECTION_DISTANCE) * 0.3,
              age: 0,
            });
          }
        }
      }

      // Draw connections
      connections.forEach((conn) => {
        const p1 = particles[conn.p1];
        const p2 = particles[conn.p2];

        ctx.strokeStyle = `rgba(100, 180, 255, ${conn.opacity * 0.6})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      });

      // Draw ripples
      setRipples((prevRipples) =>
        prevRipples
          .map((ripple) => ({
            ...ripple,
            age: ripple.age + 1,
          }))
          .filter((ripple) => ripple.age < ripple.maxAge)
          .forEach((ripple) => {
            const progress = ripple.age / ripple.maxAge;
            const radius = progress * 200;
            const opacity = (1 - progress) * 0.4;

            ctx.strokeStyle = `rgba(100, 180, 255, ${opacity})`;
            ctx.lineWidth = 2 - progress * 1.5;
            ctx.beginPath();
            ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
            ctx.stroke();
          })
      );

      animationIdRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
    };
  }, []);

  // Handle touch/mouse events for ripple effect
  const handleInteraction = (e: React.MouseEvent | React.TouchEvent) => {
    if (RESPECTS_REDUCED_MOTION) return;

    let x: number, y: number;

    if ('touches' in e) {
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
    } else {
      x = e.clientX;
      y = e.clientY;
    }

    // Check if click is on an app icon or important UI element
    const target = document.elementFromPoint(x, y);
    if (
      target?.closest('.app-icon') ||
      target?.closest('.add-app-button-top-right') ||
      target?.closest('.app-drawer')
    ) {
      // Don't create ripple on UI elements
      return;
    }

    setRipples((prev) => [
      ...prev,
      {
        x,
        y,
        age: 0,
        maxAge: 40,
      },
    ]);

    // Update mouse position for parallax
    setMousePos({ x, y });
  };

  // Data stream effect (CSS-based, no Canvas needed)
  // The animated background will have layered effects

  return (
    <div className="animated-background">
      {/* Layer 1: Atmospheric gradient background */}
      <div className="bg-atmosphere"></div>

      {/* Layer 2: Ambient light sources */}
      <div className="bg-ambient-light-1"></div>
      <div className="bg-ambient-light-2"></div>
      <div className="bg-ambient-light-3"></div>

      {/* Layer 3: Canvas for particles and connections */}
      <canvas
        ref={canvasRef}
        className="bg-canvas"
        onClick={handleInteraction}
        onTouchStart={handleInteraction}
        onMouseMove={handleInteraction}
      />

      {/* Layer 4: Data streams */}
      <div className="bg-data-streams">
        <div className="data-stream data-stream-1"></div>
        <div className="data-stream data-stream-2"></div>
        <div className="data-stream data-stream-3"></div>
      </div>

      {/* Layer 5: Grid */}
      <div className="bg-grid"></div>

      {/* Layer 6: Top vignette */}
      <div className="bg-vignette"></div>
    </div>
  );
}
