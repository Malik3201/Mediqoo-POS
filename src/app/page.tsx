import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { DemoVideo } from "@/components/landing/DemoVideo";
import { Features } from "@/components/landing/Features";
import { Benefits } from "@/components/landing/Benefits";
import { Testimonials } from "@/components/landing/Testimonials";
import { Footer } from "@/components/landing/Footer";

export const revalidate = 60; // Revalidate the page every 60 seconds


export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background selection:bg-primary/20 selection:text-primary">
      <Header />
      <main className="flex-1">
        <Hero />
        <DemoVideo />
        <Features />
        <Benefits />
        <Testimonials />
      </main>
      <Footer />
    </div>
  );
}
