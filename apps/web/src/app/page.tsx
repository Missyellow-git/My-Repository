import { Activity, Bot, LineChart, PieChart } from 'lucide-react';
import { FundSearch } from '@/components/dashboard/fund-search';
import { Card, CardContent } from '@/components/ui';

const FEATURES = [
  {
    icon: LineChart,
    title: 'Every holding, priced live',
    body: 'The scheme’s latest disclosed portfolio, joined to NSE/BSE quotes, with weight, sector, market cap and today’s move on every row.',
  },
  {
    icon: PieChart,
    title: 'Analytics that answer a question',
    body: 'Sector and market-cap allocation, top-10 concentration, gainers and losers, and each holding’s weighted contribution to the day.',
  },
  {
    icon: Bot,
    title: 'Ask in plain English',
    body: '“Which holdings are down more than 2% today?” The figures are computed by the server — the assistant only decides what to compute.',
  },
  {
    icon: Activity,
    title: 'Month-on-month changes',
    body: 'Compare disclosure periods to see what the fund bought, sold and trimmed, with sector shift and one-way turnover.',
  },
];

export default function HomePage() {
  return (
    <div className="container py-12 sm:py-20">
      <section className="mx-auto max-w-3xl text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
          See what your mutual fund actually owns
        </h1>
        <p className="mt-4 text-base text-muted-foreground sm:text-lg">
          Search any Indian mutual fund scheme and get its latest disclosed portfolio with live
          market prices, sector analytics and an assistant that answers questions about it. No
          uploads, no account required.
        </p>

        <div className="mt-8">
          <FundSearch autoFocus />
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Holdings come from published monthly disclosures and may lag the fund&apos;s current
          positions. Every screen shows the disclosure date it is based on.
        </p>
      </section>

      <section className="mx-auto mt-16 grid max-w-5xl gap-4 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <CardContent className="flex gap-4 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <Icon className="h-5 w-5 text-primary" aria-hidden />
              </div>
              <div>
                <h2 className="text-sm font-semibold">{title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
