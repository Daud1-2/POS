import React from 'react';
import logo from '../assets/orderly-logo.png';

function Logo({ size = 36, showText = true, className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src={logo}
        alt="Orderly logo"
        style={{ width: size, height: size }}
        className="object-contain"
      />
      {showText && (
        <div className="leading-tight">
          <div className="font-semibold text-ink">Orderly</div>
          <div className="text-xs text-muted -mt-0.5">POS</div>
        </div>
      )}
    </div>
  );
}

export default Logo;
