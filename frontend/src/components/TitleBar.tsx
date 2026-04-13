import { X, Minus, Maximize, SlidersHorizontal, Globe } from "lucide-react";
import { WindowMinimise, WindowToggleMaximise, Quit } from "../../wailsjs/runtime/runtime";
import { Menubar, MenubarContent, MenubarMenu, MenubarItem, MenubarTrigger } from "@/components/ui/menubar";
import { openExternal } from "@/lib/utils";
export function TitleBar() {
    const handleMinimize = () => {
        WindowMinimise();
    };
    const handleMaximize = () => {
        WindowToggleMaximise();
    };
    const handleClose = () => {
        Quit();
    };
    return (<>

      <div className="fixed top-0 left-14 right-0 h-10 z-40 bg-background/80 backdrop-blur-sm" style={{ "--wails-draggable": "drag" } as React.CSSProperties} onDoubleClick={handleMaximize}/>


      <div className="fixed top-1.5 right-2 z-50 flex h-7 gap-0.5 items-center">
        <Menubar className="border-none bg-transparent shadow-none px-0 mr-1" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}>
            <MenubarMenu>
                <MenubarTrigger className="cursor-pointer w-8 h-7 p-0 flex items-center justify-center hover:bg-muted transition-colors rounded data-[state=open]:bg-muted">
                    <SlidersHorizontal className="w-3.5 h-3.5"/>
                </MenubarTrigger>
                <MenubarContent align="end" className="min-w-[200px]">
                    <MenubarItem onClick={() => openExternal("https://afkarxyz.qzz.io")} className="gap-2">
                        <Globe className="w-4 h-4 opacity-70"/>
                        <span>Website</span>
                    </MenubarItem>
                </MenubarContent>
            </MenubarMenu>
        </Menubar>
        <button onClick={handleMinimize} className="w-8 h-7 flex items-center justify-center hover:bg-muted transition-colors rounded" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties} aria-label="Minimize">
          <Minus className="w-3.5 h-3.5"/>
        </button>
        <button onClick={handleMaximize} className="w-8 h-7 flex items-center justify-center hover:bg-muted transition-colors rounded" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties} aria-label="Maximize">
          <Maximize className="w-3.5 h-3.5"/>
        </button>
        <button onClick={handleClose} className="w-8 h-7 flex items-center justify-center hover:bg-destructive hover:text-white transition-colors rounded" style={{ "--wails-draggable": "no-drag" } as React.CSSProperties} aria-label="Close">
          <X className="w-3.5 h-3.5"/>
        </button>
      </div>
    </>);
}
