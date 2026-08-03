export function SiteFooter() {
  return (
    <footer className="border-t py-6">
      <div className="container space-y-2 text-xs leading-relaxed text-muted-foreground">
        {/*
          This disclosure is not decorative. The product joins month-old
          disclosed holdings to live prices, and a user who does not understand
          that pairing can badly misread the screen. It is stated once, plainly,
          on every page rather than buried in a terms link.
        */}
        <p>
          <strong className="text-foreground">Data note.</strong> Portfolio holdings come from each
          scheme&apos;s latest published monthly disclosure and may not reflect the fund&apos;s
          current positions. Prices are provided for information only and may be delayed. Figures
          shown are computed from this data; AI commentary is clearly labelled and may contain
          errors.
        </p>
        <p>
          FundLens is not a registered investment adviser. Nothing here is investment advice or a
          recommendation, and nothing is personalised to your circumstances.
        </p>
        <p>© {new Date().getFullYear()} FundLens</p>
      </div>
    </footer>
  );
}
