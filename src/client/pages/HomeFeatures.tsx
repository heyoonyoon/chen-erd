/**
 * 첫 화면의 이용 안내. 가입, 링크, 언어, 보관 기간을 아이콘이나 카드 없이 글로만 적는다.
 */
import { useId } from 'react';
import { useT, type MessageKey } from '../i18n';
import { Reveal } from './motion';

const FACTS: Array<{ id: string; title: MessageKey; body: MessageKey }> = [
  { id: 'signup', title: 'home.fact.signup.title', body: 'home.fact.signup.body' },
  { id: 'link', title: 'home.fact.link.title', body: 'home.fact.link.body' },
  { id: 'languages', title: 'home.fact.languages.title', body: 'home.fact.languages.body' },
  { id: 'expiry', title: 'home.fact.expiry.title', body: 'home.fact.expiry.body' },
];

export function HomeFacts() {
  const t = useT();
  const factsId = useId();
  return (
    <section className="home-facts-band" aria-labelledby={factsId} data-testid="home-facts">
      <Reveal>
        <h2 id={factsId} className="home-section-title">
          {t('home.facts.label')}
        </h2>
      </Reveal>
      <div className="home-facts">
        {FACTS.map((f, i) => (
          <Reveal key={f.id} className="home-fact" delay={i * 80}>
            <h3 className="home-fact-title">{t(f.title)}</h3>
            <p className="home-fact-body">{t(f.body)}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
