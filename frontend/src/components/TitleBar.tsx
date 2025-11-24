import { useState } from "react";
import { X, Minus, Square } from "lucide-react";
import { WindowMinimise, WindowToggleMaximise, Quit } from "../../wailsjs/runtime/runtime";

export function TitleBar() {
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);

  const handleMinimize = () => {
    WindowMinimise();
  };

  const handleMaximize = () => {
    WindowToggleMaximise();
  };

  const handleClose = () => {
    Quit();
  };

  return (
    <>
      {/* Draggable area */}
      <div 
        className="fixed top-0 left-0 right-0 h-12 z-40"
        style={{ "--wails-draggable": "drag" } as React.CSSProperties}
        onDoubleClick={handleMaximize}
      />
      
      {/* Window control buttons */}
      <div className="fixed top-4 left-4 z-50 flex gap-2">
        <button
          onClick={handleClose}
          onMouseEnter={() => setHoveredButton("close")}
          onMouseLeave={() => setHoveredButton(null)}
          className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center"
          style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
          aria-label="Close"
        >
          {hoveredButton === "close" && (
            <X className="w-2 h-2 text-red-900" strokeWidth={3} />
          )}
        </button>
        <button
          onClick={handleMinimize}
          onMouseEnter={() => setHoveredButton("minimize")}
          onMouseLeave={() => setHoveredButton(null)}
          className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors flex items-center justify-center"
          style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
          aria-label="Minimize"
        >
          {hoveredButton === "minimize" && (
            <Minus className="w-2 h-2 text-yellow-900" strokeWidth={3} />
          )}
        </button>
        <button
          onClick={handleMaximize}
          onMouseEnter={() => setHoveredButton("maximize")}
          onMouseLeave={() => setHoveredButton(null)}
          className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-colors flex items-center justify-center"
          style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
          aria-label="Maximize"
        >
          {hoveredButton === "maximize" && (
            <Square className="w-1.5 h-1.5 text-green-900" strokeWidth={3} />
          )}
        </button>
      </div>
    </>
  );
}
