/**
 * 화면 아래에 잠깐 뜨는 알림. [담당: topbar 에이전트]
 */
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import './toast.css';

export type ToastKind = 'info' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

/** 알림이 떠 있는 시간(ms) */
export const TOAST_DURATION: Record<ToastKind, number> = { info: 2500, error: 4000 };
/** 한 번에 보여 주는 최대 개수. 넘치면 오래된 것부터 지운다. */
const MAX_TOASTS = 4;

interface ToastState {
  items: ToastItem[];
  push(item: ToastItem): void;
  dismiss(id: number): void;
  clear(): void;
}

export const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (item) => set((s) => ({ items: [...s.items, item].slice(-MAX_TOASTS) })),
  dismiss: (id) =>
    set((s) => (s.items.some((t) => t.id === id) ? { items: s.items.filter((t) => t.id !== id) } : s)),
  clear: () => set({ items: [] }),
}));

let nextId = 1;

/** 어디서든 호출할 수 있다. 예: toast('링크를 복사했습니다') */
export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const store = useToasts.getState();
  // 같은 알림이 이미 떠 있으면 쌓지 않고 새것으로 바꾼다(버튼을 연달아 누른 경우)
  for (const t of store.items) {
    if (t.message === message && t.kind === kind) store.dismiss(t.id);
  }
  const id = nextId++;
  store.push({ id, message, kind });
  setTimeout(() => useToasts.getState().dismiss(id), TOAST_DURATION[kind]);
}

/** 알림을 그리는 컴포넌트. TopBar가 한 번 렌더링한다(position: fixed). */
export function Toaster() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  if (typeof document === 'undefined') return null;
  // 상단 바의 쌓임 맥락에 갇히지 않도록 body에 직접 그린다(도움말 같은 덮개 위에도 보여야 한다)
  return createPortal(
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast-item${t.kind === 'error' ? ' toast-error' : ''}`}
          data-testid="toast"
          data-kind={t.kind}
          onClick={() => dismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>,
    document.body,
  );
}
