/**
 * 다이어그램 검증 결과 패널. ui.panels.issues가 true일 때 렌더링된다. [담당: rules 에이전트]
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { nodeCenter } from '../../shared/geometry';
import { validateDiagram } from '../../shared/rules';
import type { ErdEdge, ErdNode, Issue, Point } from '../../shared/types';
import { centerOn } from '../canvas/ViewportControls';
import { useEdges, useNodes } from '../collab/hooks';
import { tSentence, useT } from '../i18n';
import { ui } from '../state/ui';
import './IssuesPanel.css';

/** 강조 표시를 유지하는 시간(ms) */
const HIGHLIGHT_MS = 2000;

// 상단 바의 배지와 패널이 같은 문서를 두 번 검사하지 않도록 마지막 결과를 기억한다
let lastRun: { nodes: ErdNode[]; edges: ErdEdge[]; issues: Issue[] } | null = null;

function issuesFor(nodes: ErdNode[], edges: ErdEdge[]): Issue[] {
  if (lastRun && lastRun.nodes === nodes && lastRun.edges === edges) return lastRun.issues;
  const issues = validateDiagram(nodes, edges);
  lastRun = { nodes, edges, issues };
  return issues;
}

function useIssues(): Issue[] {
  const nodes = useNodes();
  const edges = useEdges();
  return useMemo(() => issuesFor(nodes, edges), [nodes, edges]);
}

function countIssues(issues: Issue[]): { errors: number; warnings: number } {
  let errors = 0;
  for (const issue of issues) if (issue.severity === 'error') errors++;
  return { errors, warnings: issues.length - errors };
}

/** 현재 문서의 문제 개수(상단 바의 배지에 사용) */
export function useIssueCount(): { errors: number; warnings: number } {
  const issues = useIssues();
  return useMemo(() => countIssues(issues), [issues]);
}

/** 요소의 가운데(월드 좌표). 노드는 중심, 엣지는 양 끝 노드 중심의 중점. 찾을 수 없으면 null */
export function elementCenter(id: string, nodes: ErdNode[], edges: ErdEdge[]): Point | null {
  const node = nodes.find((n) => n.id === id);
  if (node) return nodeCenter(node);
  const edge = edges.find((e) => e.id === id);
  if (!edge) return null;
  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  if (source && target) {
    const a = nodeCenter(source);
    const b = nodeCenter(target);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  const present = source ?? target;
  return present ? nodeCenter(present) : null;
}

function ErrorIcon() {
  return (
    <svg className="issues-icon issues-icon-error" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M8 4.2v4.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="1" fill="#fff" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="issues-icon issues-icon-warning" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.6 15 14H1L8 1.6Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6.2v3.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="12" r="0.9" fill="#fff" />
    </svg>
  );
}

function OkIcon() {
  return (
    <svg className="issues-icon issues-icon-ok" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="m4.8 8.2 2.2 2.2 4.2-4.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="m3 3 8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function IssuesPanel() {
  const t = useT();
  const nodes = useNodes();
  const edges = useEdges();
  const issues = useMemo(() => issuesFor(nodes, edges), [nodes, edges]);
  const { errors, warnings } = useMemo(() => countIssues(issues), [issues]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 패널을 닫을 때 강조가 남지 않게 한다
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
        ui().setHighlight([]);
      }
    },
    [],
  );

  const focusIssue = (issue: Issue) => {
    setActiveId(issue.id);
    ui().setSelection(issue.elementIds);
    ui().setHighlight(issue.elementIds);
    for (const id of issue.elementIds) {
      const center = elementCenter(id, nodes, edges);
      if (center) {
        centerOn(center);
        break;
      }
    }
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      ui().setHighlight([]);
    }, HIGHLIGHT_MS);
  };

  return (
    <section className="panel issues-panel" data-testid="issues-panel" aria-label={t('issues.title')}>
      <header className="issues-header">
        <h2 className="issues-title">{t('issues.title')}</h2>
        <button
          type="button"
          className="btn btn-ghost btn-icon issues-close"
          aria-label={t('common.close')}
          title={t('common.close')}
          data-testid="issues-close"
          onClick={() => ui().togglePanel('issues', false)}
        >
          <CloseIcon />
        </button>
      </header>

      {issues.length === 0 ? (
        <p className="issues-empty" data-testid="issues-empty">
          <OkIcon />
          <span>{t('issues.empty')}</span>
        </p>
      ) : (
        <>
          <div className="issues-summary" data-testid="issues-summary">
            <span className={`issues-count${errors > 0 ? ' is-error' : ''}`} data-testid="issues-error-count">
              <ErrorIcon />
              {t('count.errors', { count: errors })}
            </span>
            <span className={`issues-count${warnings > 0 ? ' is-warning' : ''}`} data-testid="issues-warning-count">
              <WarningIcon />
              {t('count.warnings', { count: warnings })}
            </span>
          </div>
          <ul className="issues-list">
            {issues.map((issue) => (
              <li key={issue.id}>
                <button
                  type="button"
                  className={`issues-item${issue.id === activeId ? ' is-active' : ''}`}
                  data-testid="issue-item"
                  data-issue-id={issue.id}
                  data-severity={issue.severity}
                  onClick={() => focusIssue(issue)}
                >
                  {issue.severity === 'error' ? <ErrorIcon /> : <WarningIcon />}
                  <span className="sr-only">{issue.severity === 'error' ? t('common.error') : t('common.warning')}</span>
                  <span className="issues-message">{tSentence(issue.message)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
