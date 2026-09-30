/** What a page in the navigation says about itself in its "Start here" intro (PageIntro). */
export interface CapabilityGuide {
  /** remembers the intro's collapsed state; one per page */
  id: string;
  /** the capability's name as the navigation shows it */
  title: string;
  /** What can I do here? One plain sentence. */
  what: string;
  /** When should I use it? A concrete use case. */
  when: string;
  /** What do I need? The live checks beside it say what is already in place. */
  needs: string;
  /** How do I start? Names the primary action on the page. */
  start: string;
  /** What will I get? The completed state or output. */
  result: string;
  /** pages you read rather than build on: how to inspect, interpret and act */
  reading?: { title: string; items: string[] };
  /** what separates a good result from one that is merely valid */
  quality?: { title: string; items: string[] };
}
