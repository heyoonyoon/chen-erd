/**
 * 이름 입력 창. 저장된 이름이 없으면 방에 들어올 때 자동으로 뜬다. [담당: presence 에이전트]
 */
import { useEffect, useId, useRef, useState } from 'react';
import { create } from 'zustand';
import { USER_COLORS } from '../../shared/types';
import { useRoom } from '../collab/hooks';
import { getIdentity, saveIdentity } from '../identity';
import { NAME_MAX, initialOf, normalizeName, safeColor } from './presenceMath';
import './NicknameDialog.css';

interface NicknameDialogState {
  open: boolean;
  /** 이름이 없어서 자동으로 열린 경우. 이름을 넣기 전에는 닫을 수 없다. */
  forced: boolean;
}

export const useNicknameDialog = create<NicknameDialogState>(() => ({ open: false, forced: false }));

/** 다른 곳(아바타 클릭 등)에서 이름 입력 창을 여는 함수 */
export function openNicknameDialog(): void {
  // 자동으로 열려 있는 중이면 그 상태(닫을 수 없음)를 유지한다
  if (!useNicknameDialog.getState().open) useNicknameDialog.setState({ open: true, forced: false });
}

function closeDialog(): void {
  useNicknameDialog.setState({ open: false, forced: false });
}

/** USER_COLORS와 같은 순서의 색 이름(읽기 도구용) */
const COLOR_NAMES = ['빨강', '주황', '노랑', '초록', '청록', '하늘', '파랑', '보라', '분홍', '갈색'];

export function NicknameDialog() {
  const room = useRoom();
  const open = useNicknameDialog((s) => s.open);
  const forced = useNicknameDialog((s) => s.forced);

  // 방에 들어왔는데 저장된 이름이 없으면 먼저 이름을 묻는다
  useEffect(() => {
    if (!getIdentity().name.trim()) useNicknameDialog.setState({ open: true, forced: true });
    return closeDialog;
  }, [room]);

  if (!open) return null;
  return <NicknameForm forced={forced} />;
}

function NicknameForm({ forced }: { forced: boolean }) {
  const room = useRoom();
  const [initial] = useState(getIdentity);
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const hintId = useId();

  const clean = normalizeName(name);

  const submit = () => {
    if (!clean) {
      inputRef.current?.focus();
      return;
    }
    const user = saveIdentity({ name: clean, color });
    room.setPresence({ user });
    closeDialog();
  };

  // 창 밖의 키 처리기가 항상 최신 값을 보게 한다
  const latest = useRef({ submit, forced });
  latest.current = { submit, forced };

  useEffect(() => {
    const before = document.activeElement;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);

  useEffect(() => {
    // 창이 떠 있는 동안의 키 입력은 여기서 모두 처리하고 더 내려보내지 않는다.
    // window의 캡처 단계라서 전역 단축키가 어떤 방식으로 등록되어 있어도 새지 않는다.
    // 글자 입력, Tab 이동, 버튼의 Enter/Space 같은 브라우저 기본 동작은 그대로 일어난다.
    const onKeyDown = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      e.stopImmediatePropagation();
      const composing = e.isComposing || e.keyCode === 229;

      if (e.key === 'Escape') {
        if (!composing && !latest.current.forced) closeDialog();
        return;
      }
      if (e.key === 'Enter' && e.target === inputRef.current) {
        // 한글 조합 중의 Enter는 글자 확정이다
        if (composing) return;
        e.preventDefault();
        latest.current.submit();
        return;
      }
      if (e.key === 'Tab') {
        const items = Array.from(panel.querySelectorAll<HTMLElement>('input, button:not([disabled])'));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !panel.contains(active) || active === panel) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return (
    <div
      className="nickname-overlay"
      data-testid="nickname-overlay"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        // 바깥을 눌러도 포커스가 창 밖으로 나가지 않게 한다
        e.preventDefault();
        if (!forced) closeDialog();
      }}
    >
      <div
        ref={panelRef}
        className="panel nickname-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        tabIndex={-1}
        data-testid="nickname-dialog"
      >
        <h2 id={titleId} className="nickname-title">
          이름을 알려 주세요
        </h2>
        <p id={hintId} className="nickname-hint">
          다른 팀원 화면에 이 이름으로 표시됩니다
        </p>

        <div className="nickname-row">
          <span className="nickname-preview" style={{ background: safeColor(color) }} aria-hidden="true">
            {initialOf(name)}
          </span>
          <input
            ref={inputRef}
            className="input nickname-input"
            data-testid="nickname-input"
            type="text"
            value={name}
            maxLength={NAME_MAX}
            placeholder="이름"
            aria-label="이름"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="nickname-label">색</div>
        <div className="nickname-colors">
          {USER_COLORS.map((c, i) => (
            <button
              key={c}
              type="button"
              className={c === color ? 'nickname-color is-active' : 'nickname-color'}
              data-testid="nickname-color"
              data-color={c}
              style={{ background: c }}
              title={COLOR_NAMES[i] ?? c}
              aria-label={COLOR_NAMES[i] ?? c}
              aria-pressed={c === color}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        <div className="nickname-actions">
          <button type="button" className="btn btn-primary" data-testid="nickname-submit" disabled={!clean} onClick={submit}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
