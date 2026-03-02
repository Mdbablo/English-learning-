
import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  isProcessing: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isActive, isProcessing }) => {
  const bars = Array.from({ length: 20 });

  return (
    <div className="flex items-center justify-center gap-1 h-16">
      {bars.map((_, i) => (
        <div
          key={i}
          className={`w-1 bg-blue-500 rounded-full transition-all duration-200 ${
            isActive ? 'animate-bounce' : 'h-2'
          }`}
          style={{
            animationDelay: `${i * 0.05}s`,
            height: isActive ? `${Math.random() * 40 + 10}px` : '8px',
            backgroundColor: isProcessing ? '#3b82f6' : '#6b7280',
            opacity: isProcessing ? 1 : 0.5
          }}
        />
      ))}
    </div>
  );
};
