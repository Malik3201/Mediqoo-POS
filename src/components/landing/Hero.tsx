import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-background pt-16 md:pt-24 lg:pt-32">
      {/* Background decoration */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <div className="absolute -top-[30%] -right-[10%] h-[1000px] w-[1000px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute top-[20%] -left-[10%] h-[800px] w-[800px] rounded-full bg-secondary/30 blur-3xl" />
      </div>

      <div className="container relative z-10 mx-auto px-4 md:px-6">
        <div className="flex flex-col items-center text-center lg:mx-auto lg:max-w-4xl">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-sm text-primary">
            <span className="flex h-2 w-2 rounded-full bg-primary mr-2 animate-pulse" />
            The Future of Pharmacy Management
          </div>
          
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
            Streamline your pharmacy with <span className="text-primary">Aivrasol POS</span>
          </h1>
          
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
            A comprehensive, secure, and blazing fast Point of Sale system designed specifically for modern pharmacies. Manage inventory, process billing, and gain insights effortlessly.
          </p>
          
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/dashboard"
              className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-8 text-base font-medium text-primary-foreground shadow-lg transition-all hover:scale-105 hover:bg-primary/90 hover:shadow-primary/25"
            >
              Get Started Free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link
              href="#features"
              className="inline-flex h-12 items-center justify-center rounded-full border border-border bg-background px-8 text-base font-medium text-foreground transition-all hover:bg-muted"
            >
              Explore Features
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground sm:gap-8">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              No credit card required
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              14-day free trial
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Cancel anytime
            </div>
          </div>
        </div>

        {/* Dashboard Mockup */}
        <div className="relative mx-auto mt-16 max-w-5xl md:mt-24">
          <div className="rounded-xl border border-border/50 bg-background/50 p-2 shadow-2xl backdrop-blur-sm lg:p-4">
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-inner">
              <div className="aspect-[16/9] w-full bg-muted/30 relative">
                {/* Simulated App UI */}
                <div className="absolute inset-0 flex flex-col">
                  {/* Top bar */}
                  <div className="flex h-12 items-center justify-between border-b border-border px-4 bg-background">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-destructive/80" />
                      <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
                      <div className="h-3 w-3 rounded-full bg-green-500/80" />
                    </div>
                    <div className="h-6 w-1/3 rounded bg-muted" />
                    <div className="h-6 w-24 rounded bg-primary/20" />
                  </div>
                  {/* Content area */}
                  <div className="flex flex-1 p-4 gap-4">
                    {/* Sidebar */}
                    <div className="w-48 hidden md:flex flex-col gap-2">
                      <div className="h-8 w-full rounded bg-primary/10" />
                      <div className="h-8 w-full rounded bg-muted/50" />
                      <div className="h-8 w-full rounded bg-muted/50" />
                      <div className="h-8 w-full rounded bg-muted/50" />
                    </div>
                    {/* Main area */}
                    <div className="flex-1 flex flex-col gap-4">
                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-4 h-24">
                        <div className="rounded border border-border bg-card p-3 flex flex-col justify-between">
                          <div className="h-4 w-20 rounded bg-muted" />
                          <div className="h-8 w-24 rounded bg-primary/20" />
                        </div>
                        <div className="rounded border border-border bg-card p-3 flex flex-col justify-between">
                          <div className="h-4 w-20 rounded bg-muted" />
                          <div className="h-8 w-24 rounded bg-muted" />
                        </div>
                        <div className="rounded border border-border bg-card p-3 flex flex-col justify-between">
                          <div className="h-4 w-20 rounded bg-muted" />
                          <div className="h-8 w-24 rounded bg-muted" />
                        </div>
                      </div>
                      {/* Chart area */}
                      <div className="flex-1 rounded border border-border bg-card p-4 relative overflow-hidden">
                         <div className="absolute bottom-0 left-0 right-0 h-3/4 bg-gradient-to-t from-primary/10 to-transparent" />
                         <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
                           <path d="M0,100 C100,80 200,120 300,60 C400,0 500,40 600,20 L600,200 L0,200 Z" fill="var(--color-primary)" opacity="0.1" />
                           <path d="M0,100 C100,80 200,120 300,60 C400,0 500,40 600,20" fill="none" stroke="var(--color-primary)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                         </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
