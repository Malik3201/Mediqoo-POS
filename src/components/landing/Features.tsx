import { Barcode, Package, Receipt, LineChart, Store, Cloud } from "lucide-react";

const features = [
  {
    name: "Fast & Accurate Billing",
    description: "Process transactions in seconds with barcode scanning, quick search, and customizable invoice templates.",
    icon: Receipt,
  },
  {
    name: "Intelligent Inventory",
    description: "Never run out of stock. Get low-stock alerts, track expiry dates, and automate your reordering process.",
    icon: Package,
  },
  {
    name: "Real-time Analytics",
    description: "Make data-driven decisions with comprehensive reports on sales, margins, and employee performance.",
    icon: LineChart,
  },
  {
    name: "Barcode Scanner Ready",
    description: "Plug and play support for industry-standard barcode scanners to speed up checkouts and stock-taking.",
    icon: Barcode,
  },
  {
    name: "Multi-Store Management",
    description: "Manage multiple pharmacy branches from a single centralized dashboard seamlessly.",
    icon: Store,
  },
  {
    name: "Secure Cloud Backup",
    description: "Your data is automatically backed up to secure cloud servers, ensuring peace of mind.",
    icon: Cloud,
  },
];

export function Features() {
  return (
    <section id="features" className="bg-muted/50 py-24 md:py-32">
      <div className="container mx-auto px-4 md:px-6">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Everything you need to run your pharmacy
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Aivrasol POS comes packed with features designed specifically for the unique challenges of pharmacy management.
          </p>
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 sm:grid-cols-2 md:gap-12 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.name}
              className="group relative rounded-2xl border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md hover:-translate-y-1 hover:border-primary/50"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <feature.icon className="h-6 w-6" />
              </div>
              <h3 className="mb-2 text-xl font-semibold text-foreground">
                {feature.name}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
