/** Per-tab input-device facts. Once a stylus is seen, touches pan instead of draw (palm rejection). */
const state = { pen: false };

export const markPenDetected = () => {
  state.pen = true;
};
export const isPenDetected = () => state.pen;
