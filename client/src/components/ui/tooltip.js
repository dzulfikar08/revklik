import { jsx as _jsx } from "react/jsx-runtime";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipContent = ({ children, ...props }) => (_jsx(TooltipPrimitive.Portal, { children: _jsx(TooltipPrimitive.Content, { sideOffset: 6, side: "top", ...props, style: {
            background: "var(--bg3)",
            color: "var(--text)",
            border: "1px solid var(--border2)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 11,
            fontFamily: "var(--mono)",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 16px rgba(0,0,0,.5)",
            zIndex: 200,
            ...props.style,
        }, children: children }) }));
