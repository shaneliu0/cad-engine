import { useRef, useState } from "react";
import type { JSX } from "react";
import { motion } from "motion/react";
import type { Transition } from "motion/react";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { useWideLayout } from "../hooks/useWideLayout";
import { NewQuotePage } from "./NewQuotePage";
import { QuoteHistoryPage } from "./QuoteHistoryPage";

const FORM_COLUMN_WIDTH: number = 328;
const COLUMN_GAP: number = 20;
const COLLAPSE_SECONDS: number = 0.44;
const COLLAPSE_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];

export function HomePage(): JSX.Element {
  const wide = useWideLayout();
  const reducedMotion = useReducedMotion();
  const [selecting, setSelecting] = useState<boolean>(false);
  const [historyLoaded, setHistoryLoaded] = useState<boolean>(false);
  const [refreshToken, setRefreshToken] = useState<number>(0);
  const quotesCreated = useRef<boolean>(false);

  const collapsed: boolean = wide && selecting;
  const historyMounted: boolean = wide && (historyLoaded || !collapsed);
  if (wide && !collapsed && !historyLoaded) {
    setHistoryLoaded(true);
  }
  if (!wide && historyLoaded) {
    setHistoryLoaded(false);
  }

  const transition: Transition = reducedMotion
    ? { duration: 0 }
    : { duration: COLLAPSE_SECONDS, ease: COLLAPSE_EASE };

  function handleSelectionChange(hasFiles: boolean): void {
    setSelecting(hasFiles);
    if (!hasFiles && quotesCreated.current) {
      quotesCreated.current = false;
      setRefreshToken((token: number) => token + 1);
    }
  }

  return (
    <div className={wide ? "home-split" : undefined} data-expanded={collapsed || undefined}>
      <motion.div
        className={wide ? "home-form" : undefined}
        initial={false}
        animate={{ width: wide && !collapsed ? FORM_COLUMN_WIDTH : "100%" }}
        transition={transition}
      >
        <NewQuotePage
          onSelectionChange={handleSelectionChange}
          onQuoteCreated={() => {
            quotesCreated.current = true;
          }}
        />
      </motion.div>
      {wide && (
        <motion.section
          className="home-history"
          aria-label="Quote history"
          aria-hidden={collapsed || undefined}
          inert={collapsed}
          initial={false}
          animate={
            collapsed
              ? {
                  opacity: 0,
                  height: 0,
                  marginLeft: 0,
                  transitionEnd: { visibility: "hidden" as const },
                }
              : { opacity: 1, height: "auto", marginLeft: COLUMN_GAP, visibility: "visible" as const }
          }
          transition={transition}
        >
          <div className="home-history-inner">
            {historyMounted && <QuoteHistoryPage variant="panel" refreshToken={refreshToken} />}
          </div>
        </motion.section>
      )}
    </div>
  );
}
