import { Check } from "lucide-react";
import Image from "next/image";

export function Benefits() {
  return (
    <section id="benefits" className="py-24 md:py-32">
      <div className="container mx-auto px-4 md:px-6">
        
        {/* Benefit 1 */}
        <div className="mb-24 flex flex-col items-center gap-12 lg:flex-row">
          <div className="flex-1 space-y-6 lg:pr-12">
            <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
              Intuitive Design
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Focus on your patients, not on learning software
            </h2>
            <p className="text-lg text-muted-foreground">
              Our point of sale interface is designed with absolute simplicity in mind. Train new staff in minutes and reduce checkout queues significantly during rush hours.
            </p>
            <ul className="space-y-3">
              {[
                "Minimalist, distraction-free interface",
                "Keyboard shortcuts for lightning-fast billing",
                "Customizable quick-access items",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20">
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative flex-1">
            <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-muted/30 shadow-xl">
              {/* Abstract Representation of UI */}
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/5 to-secondary/20 p-8">
                <div className="w-full h-full rounded-lg bg-card shadow-sm border border-border flex flex-col p-4">
                  <div className="flex gap-4 mb-4">
                    <div className="h-8 w-2/3 bg-muted rounded"></div>
                    <div className="h-8 w-1/3 bg-primary/20 rounded"></div>
                  </div>
                  <div className="flex-1 flex gap-4">
                     <div className="w-2/3 flex flex-col gap-2">
                        <div className="h-12 bg-muted/50 rounded w-full"></div>
                        <div className="h-12 bg-muted/50 rounded w-full"></div>
                        <div className="h-12 bg-muted/50 rounded w-full"></div>
                     </div>
                     <div className="w-1/3 bg-muted/30 rounded flex flex-col justify-end p-4">
                        <div className="h-4 w-full bg-muted mb-2 rounded"></div>
                        <div className="h-8 w-full bg-primary rounded"></div>
                     </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Benefit 2 */}
        <div className="flex flex-col-reverse items-center gap-12 lg:flex-row">
          <div className="relative flex-1 w-full">
            <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-muted/30 shadow-xl">
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-tr from-secondary/20 to-primary/5 p-8">
                 <div className="w-full h-full relative">
                    <div className="absolute inset-x-4 bottom-4 top-12 rounded-lg bg-card border border-border shadow flex items-end p-4 gap-2">
                      <div className="w-1/6 bg-primary/40 h-1/3 rounded-t"></div>
                      <div className="w-1/6 bg-primary/60 h-1/2 rounded-t"></div>
                      <div className="w-1/6 bg-primary/80 h-3/4 rounded-t"></div>
                      <div className="w-1/6 bg-primary h-full rounded-t"></div>
                      <div className="w-1/6 bg-primary/90 h-5/6 rounded-t"></div>
                      <div className="w-1/6 bg-primary/70 h-2/3 rounded-t"></div>
                    </div>
                 </div>
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-6 lg:pl-12">
            <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
              Powerful Analytics
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Insights that drive pharmacy growth
            </h2>
            <p className="text-lg text-muted-foreground">
              Stop guessing and start knowing. Our comprehensive dashboards give you real-time visibility into your sales, profits, and staff performance.
            </p>
            <ul className="space-y-3">
              {[
                "Identify top-selling & high-margin medicines",
                "Automated end-of-day sales reports",
                "Track expiry trends and reduce waste",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20">
                    <Check className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

      </div>
    </section>
  );
}
