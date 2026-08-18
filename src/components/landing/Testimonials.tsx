import { Star } from "lucide-react";

const testimonials = [
  {
    content: "Switching to Aivrasol was the best decision for our pharmacy chain. The multi-store management feature alone saved us hours of daily reconciliation.",
    author: "Dr. Sarah Ahmed",
    role: "Owner, CarePlus Pharmacies",
    rating: 5,
  },
  {
    content: "The interface is so intuitive that my new staff members were able to start billing within 15 minutes of training. Absolutely fantastic system.",
    author: "Mohammad Ali",
    role: "Manager, City Health Pharmacy",
    rating: 5,
  },
  {
    content: "I love the expiry tracking. It alerts us way in advance, helping us manage our stock better and reduce our wastage by almost 40%.",
    author: "Fatima Noor",
    role: "Lead Pharmacist, MedLife",
    rating: 5,
  },
];

export function Testimonials() {
  return (
    <section id="testimonials" className="bg-primary/5 py-24 md:py-32">
      <div className="container mx-auto px-4 md:px-6">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Trusted by Pharmacies Everywhere
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Don't just take our word for it. Here is what our customers have to say about Aivrasol POS.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {testimonials.map((testimonial, index) => (
            <div
              key={index}
              className="flex flex-col justify-between rounded-2xl border border-border bg-card p-8 shadow-sm transition-all hover:shadow-md"
            >
              <div>
                <div className="mb-4 flex gap-1">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="h-5 w-5 fill-primary text-primary" />
                  ))}
                </div>
                <p className="mb-6 text-lg italic text-muted-foreground">
                  "{testimonial.content}"
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground">{testimonial.author}</p>
                <p className="text-sm text-muted-foreground">{testimonial.role}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="mt-20 grid grid-cols-2 gap-8 divide-x divide-border border-t border-border pt-12 md:grid-cols-4">
          <div className="flex flex-col items-center text-center">
            <span className="text-4xl font-extrabold text-primary">500+</span>
            <span className="mt-2 text-sm font-medium text-muted-foreground">Active Pharmacies</span>
          </div>
          <div className="flex flex-col items-center text-center">
            <span className="text-4xl font-extrabold text-primary">10M+</span>
            <span className="mt-2 text-sm font-medium text-muted-foreground">Invoices Generated</span>
          </div>
          <div className="flex flex-col items-center text-center">
            <span className="text-4xl font-extrabold text-primary">99.9%</span>
            <span className="mt-2 text-sm font-medium text-muted-foreground">Uptime Guarantee</span>
          </div>
          <div className="flex flex-col items-center text-center">
            <span className="text-4xl font-extrabold text-primary">24/7</span>
            <span className="mt-2 text-sm font-medium text-muted-foreground">Customer Support</span>
          </div>
        </div>
      </div>
    </section>
  );
}
