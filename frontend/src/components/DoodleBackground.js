import React from 'react';

const doodles = [
  // Corners
  { id: 1, src: '/doodles/pizza.png', x: 6, y: 8, size: 86, rotation: -20, opacity: 0.85 },
  { id: 2, src: '/doodles/burger.png', x: 94, y: 7, size: 98, rotation: 15, opacity: 0.75 },
  { id: 3, src: '/doodles/coffee.png', x: 6, y: 92, size: 78, rotation: -10, opacity: 0.7 },
  { id: 4, src: '/doodles/donut.png', x: 94, y: 90, size: 82, rotation: 25, opacity: 0.75 },

  // Left edge
  { id: 5, src: '/doodles/fries.png', x: 4, y: 45, size: 92, rotation: -15, opacity: 0.55 },
  { id: 6, src: '/doodles/soda.png', x: 8, y: 28, size: 72, rotation: -5, opacity: 0.65 },
  { id: 7, src: '/doodles/taco.png', x: 10, y: 70, size: 76, rotation: 12, opacity: 0.6 },
  { id: 33, src: '/doodles/pizza.png', x: 18, y: 38, size: 60, rotation: -12, opacity: 0.45 },
  { id: 34, src: '/doodles/coffee.png', x: 18, y: 58, size: 58, rotation: 10, opacity: 0.45 },

  // Right edge
  { id: 8, src: '/doodles/icecream.png', x: 96, y: 50, size: 86, rotation: 12, opacity: 0.7 },
  { id: 9, src: '/doodles/cake.png', x: 92, y: 30, size: 72, rotation: -8, opacity: 0.75 },
  { id: 10, src: '/doodles/hotdog.png', x: 92, y: 70, size: 80, rotation: 18, opacity: 0.6 },
  { id: 35, src: '/doodles/donut.png', x: 82, y: 40, size: 60, rotation: 14, opacity: 0.45 },
  { id: 36, src: '/doodles/soda.png', x: 82, y: 60, size: 58, rotation: -10, opacity: 0.45 },

  // Top edge
  { id: 11, src: '/doodles/donut.png', x: 25, y: 6, size: 62, rotation: 14, opacity: 0.6 },
  { id: 12, src: '/doodles/burger.png', x: 70, y: 8, size: 68, rotation: -10, opacity: 0.55 },
  { id: 13, src: '/doodles/pizza.png', x: 45, y: 10, size: 70, rotation: 8, opacity: 0.5 },

  // Bottom edge
  { id: 14, src: '/doodles/icecream.png', x: 26, y: 94, size: 64, rotation: -8, opacity: 0.55 },
  { id: 15, src: '/doodles/cake.png', x: 72, y: 94, size: 66, rotation: 10, opacity: 0.6 },
  { id: 16, src: '/doodles/soda.png', x: 50, y: 92, size: 62, rotation: -6, opacity: 0.5 },

  // Mid corners (keeps center clear)
  { id: 17, src: '/doodles/fries.png', x: 16, y: 18, size: 58, rotation: -12, opacity: 0.5 },
  { id: 18, src: '/doodles/taco.png', x: 84, y: 18, size: 58, rotation: 12, opacity: 0.5 },
  { id: 19, src: '/doodles/hotdog.png', x: 16, y: 82, size: 58, rotation: 16, opacity: 0.5, showOn: 'sm' },
  { id: 20, src: '/doodles/donut.png', x: 84, y: 82, size: 58, rotation: -16, opacity: 0.5, showOn: 'sm' },

  // Extra scatter near edges
  { id: 21, src: '/doodles/pizza.png', x: 12, y: 12, size: 54, rotation: -18, opacity: 0.45 },
  { id: 22, src: '/doodles/burger.png', x: 88, y: 12, size: 54, rotation: 14, opacity: 0.45 },
  { id: 23, src: '/doodles/coffee.png', x: 12, y: 88, size: 52, rotation: -8, opacity: 0.45 },
  { id: 24, src: '/doodles/icecream.png', x: 88, y: 88, size: 52, rotation: 10, opacity: 0.45 },
  { id: 25, src: '/doodles/taco.png', x: 6, y: 22, size: 50, rotation: 8, opacity: 0.4, showOn: 'sm' },
  { id: 26, src: '/doodles/soda.png', x: 6, y: 78, size: 50, rotation: -6, opacity: 0.4, showOn: 'sm' },
  { id: 27, src: '/doodles/cake.png', x: 94, y: 22, size: 50, rotation: -8, opacity: 0.4, showOn: 'sm' },
  { id: 28, src: '/doodles/hotdog.png', x: 94, y: 78, size: 50, rotation: 12, opacity: 0.4, showOn: 'sm' },
  { id: 29, src: '/doodles/fries.png', x: 22, y: 6, size: 48, rotation: -10, opacity: 0.4, showOn: 'sm' },
  { id: 30, src: '/doodles/donut.png', x: 78, y: 6, size: 48, rotation: 10, opacity: 0.4, showOn: 'sm' },
  { id: 31, src: '/doodles/icecream.png', x: 22, y: 96, size: 48, rotation: -6, opacity: 0.4, showOn: 'sm' },
  { id: 32, src: '/doodles/pizza.png', x: 78, y: 96, size: 48, rotation: 6, opacity: 0.4, showOn: 'sm' },

  // Closer to the card (left side)
  { id: 37, src: '/doodles/burger.png', x: 24, y: 32, size: 54, rotation: -8, opacity: 0.45, showOn: 'sm' },
  { id: 38, src: '/doodles/donut.png', x: 26, y: 46, size: 52, rotation: 12, opacity: 0.42, showOn: 'sm' },
  { id: 39, src: '/doodles/icecream.png', x: 24, y: 60, size: 50, rotation: -10, opacity: 0.42, showOn: 'sm' },
  { id: 40, src: '/doodles/taco.png', x: 26, y: 74, size: 50, rotation: 10, opacity: 0.42, showOn: 'sm' },
  { id: 41, src: '/doodles/coffee.png', x: 22, y: 22, size: 46, rotation: -6, opacity: 0.4, showOn: 'sm' },
  { id: 42, src: '/doodles/fries.png', x: 22, y: 82, size: 46, rotation: 8, opacity: 0.4, showOn: 'sm' },

  // Closer to the card (right side)
  { id: 43, src: '/doodles/pizza.png', x: 76, y: 32, size: 54, rotation: 8, opacity: 0.45, showOn: 'sm' },
  { id: 44, src: '/doodles/cake.png', x: 74, y: 46, size: 52, rotation: -10, opacity: 0.42, showOn: 'sm' },
  { id: 45, src: '/doodles/soda.png', x: 76, y: 60, size: 50, rotation: 10, opacity: 0.42, showOn: 'sm' },
  { id: 46, src: '/doodles/hotdog.png', x: 74, y: 74, size: 50, rotation: -10, opacity: 0.42, showOn: 'sm' },
  { id: 47, src: '/doodles/donut.png', x: 78, y: 22, size: 46, rotation: 6, opacity: 0.4, showOn: 'sm' },
  { id: 48, src: '/doodles/burger.png', x: 78, y: 82, size: 46, rotation: -8, opacity: 0.4, showOn: 'sm' },
];

function DoodleBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0">
      {doodles.map((doodle) => (
        <img
          key={doodle.id}
          src={doodle.src}
          alt=""
          className={`absolute select-none ${doodle.showOn === 'sm' ? 'hidden sm:block' : 'block'}`}
          style={{
            left: `${doodle.x}%`,
            top: `${doodle.y}%`,
            width: doodle.size,
            height: doodle.size,
            opacity: doodle.opacity,
            transform: `translate(-50%, -50%) rotate(${doodle.rotation}deg)`,
            filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.12))',
          }}
        />
      ))}
    </div>
  );
}

export default DoodleBackground;
