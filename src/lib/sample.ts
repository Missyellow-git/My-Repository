import type { GeneratedDeck } from "./types";

/**
 * A canned deck so the editor and the PNG export can be exercised without an
 * API key — and so the layout engine has a fixture that covers every slide role.
 */
export const SAMPLE_DECK: GeneratedDeck = {
  title: "Pricing mistakes",
  caption:
    "Most freelancers don't have a pricing problem. They have a positioning problem wearing a pricing costume.\n\nI spent two years charging by the hour before I worked out that every hour I got faster, I got paid less. Switching to project pricing didn't just raise my rate — it changed which clients said yes.\n\nThe five mistakes in this carousel are the ones I made myself, in roughly this order.\n\nWhich one are you still making?",
  hashtags: [
    "freelancing",
    "freelancelife",
    "pricingstrategy",
    "designbusiness",
    "solobusiness",
    "creativebusiness",
    "consulting",
    "clientwork",
    "smallbusinesstips",
    "valuebasedpricing",
  ],
  slides: [
    {
      role: "cover",
      kicker: "Year one",
      headline: "5 pricing mistakes that keep freelancers broke",
      body: "Every one of these cost me real money before I caught it.",
    },
    {
      role: "point",
      kicker: "01",
      headline: "You're selling hours, not outcomes",
      body: "Bill by the hour and every efficiency gain becomes a pay cut. The better you get, the less you earn for the same work.",
    },
    {
      role: "point",
      kicker: "02",
      headline: "Your first number is your only number",
      body: "Quote once and you've handed the client an anchor. Give a range tied to scope and you keep somewhere to move.",
    },
    {
      role: "list",
      kicker: "03",
      headline: "What you forgot to price in",
      bullets: [
        "Two rounds of revisions",
        "The kickoff call and the follow-ups",
        "Unpaid gaps between projects",
        "Software, taxes, and your own sick days",
      ],
    },
    {
      role: "quote",
      headline: "If nobody has ever said your price is too high, you have never tested it.",
      body: "The first client who walks is the one that proves you found the ceiling.",
    },
    {
      role: "point",
      kicker: "05",
      headline: "You raise prices for new clients only",
      body: "The people who already trust your work are the easiest yes. Tell them the new rate starts next project, not next invoice.",
    },
    {
      role: "cta",
      kicker: "Your move",
      headline: "Pick one and fix it this week",
      body: "Save this, then go re-quote the next project that lands in your inbox.",
    },
  ],
};
