import Link from "next/link";
import { Pill, Menu } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Pill className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold tracking-tight text-foreground">
            Aivrasol <span className="text-primary">POS</span>
          </span>
        </Link>
        <nav className="hidden gap-6 md:flex">
          <Link href="#features" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
            Features
          </Link>
          <Link href="#benefits" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
            Benefits
          </Link>
          <Link href="#testimonials" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
            Testimonials
          </Link>
        </nav>
        <div className="flex items-center gap-4">
          <Link
            href="/download"
            className="hidden items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md md:inline-flex"
          >
            Download
          </Link>
          <button className="inline-flex items-center justify-center rounded-md p-2 text-foreground md:hidden">
            <Menu className="h-6 w-6" />
            <span className="sr-only">Toggle menu</span>
          </button>
        </div>
      </div>
    </header>
  );
}
