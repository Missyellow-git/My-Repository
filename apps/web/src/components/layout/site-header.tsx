'use client';

import { Moon, Sun, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { Button } from '@/components/ui';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <TrendingUp className="h-5 w-5 text-primary" aria-hidden />
          <span>FundLens</span>
          <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
            portfolio X-ray
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">Search</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/compare">Compare</Link>
          </Button>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

/**
 * Theme toggle.
 *
 * Reads the OS preference on first load and stores an explicit choice
 * afterwards, so a user who prefers light mode on a dark-themed machine is not
 * overridden on every visit.
 */
function ThemeToggle() {
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    const stored = window.localStorage.getItem('fundlens.theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = stored ? stored === 'dark' : prefersDark;
    setIsDark(dark);
    document.documentElement.classList.toggle('dark', dark);
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    window.localStorage.setItem('fundlens.theme', next ? 'dark' : 'light');
  };

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle colour theme">
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
