import { useEffect, useRef } from "react";
import Graphics from "../Graphics.js";

export function useGraphicsMount() {
  const graphics = Graphics.getInstance();
  const mountRef = useRef(null);
  useEffect(() => {
    graphics.init(mountRef).then();
    return () => { graphics.dispose(); };
  }, [graphics, mountRef]);
  return mountRef;
}
