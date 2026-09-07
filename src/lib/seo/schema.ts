// Builders for the JSON-LD structured data the pages embed. Kept tiny and typed so
// tool and exam pages produce valid, consistent schema.org objects.

export interface HowToStep {
  name: string;
  text: string;
}

// Builds a schema.org HowTo object for a tool page.
export function howTo(name: string, description: string, steps: HowToStep[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name,
    description,
    step: steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

export interface QA {
  q: string;
  a: string;
}

// Builds a schema.org FAQPage object from question/answer pairs.
export function faqPage(qas: QA[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qas.map((qa) => ({
      '@type': 'Question',
      name: qa.q,
      acceptedAnswer: { '@type': 'Answer', text: qa.a },
    })),
  };
}
