import Link from "next/link";
import Image from "next/image";
import { Mail, Phone, MapPin } from "lucide-react";
import { FooterPortalLink } from "@/components/footer-portal-link";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-ocean-900 text-slate-300 border-t border-ocean-800">
      <div className="container py-16 max-[1024px]:py-12 max-[768px]:py-10">
        <div className="grid grid-cols-12 gap-10 max-[1024px]:grid-cols-1 max-[1024px]:gap-10 max-[768px]:gap-8">
          {/* Brand & About Section */}
          <div className="col-span-5 max-[1024px]:col-span-1 space-y-6">
            <Link
              href="/"
              className="flex items-center space-x-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-foam-400 rounded-lg w-fit"
            >
              <div className="bg-white/10 p-1.5 rounded-lg ring-1 ring-white/20 transition-colors group-hover:bg-white/20">
                <Image
                  src="/logo.png"
                  alt="Arab ShipBroker Logo"
                  width={32}
                  height={32}
                  className="h-8 w-8 object-contain brightness-0 invert"
                />
              </div>
              <span className="font-semibold text-white text-xl tracking-tight">
                Arab ShipBroker
              </span>
            </Link>
            <p className="text-sm leading-relaxed text-ocean-200/80 max-w-sm">
              Premier maritime brokerage serving the MENA region with
              specialized expertise in dry-bulk & break-bulk brokerage, vessel
              sales & purchase, and dedicated MENA shipping market insights.
            </p>
            <div className="flex items-center space-x-4">
              <a
                href="https://www.linkedin.com/company/arab-shipbroker/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ocean-300 hover:text-white transition-colors p-2 -ml-2 rounded-md hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-foam-400"
                aria-label="Visit Arab ShipBroker on LinkedIn"
              >
                <LinkedinIcon className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div className="col-span-3 max-[1024px]:col-span-1 space-y-6">
            <h3 className="text-white font-semibold text-sm uppercase tracking-wider">
              Quick Links
            </h3>
            <nav className="flex flex-col space-y-3">
              <Link
                href="/services"
                className="text-ocean-200/80 hover:text-foam-300 transition-colors text-sm w-fit focus:outline-none focus-visible:ring-2 focus-visible:ring-foam-400 rounded-sm"
              >
                Our Services
              </Link>
              <Link
                href="/market-insights"
                className="text-ocean-200/80 hover:text-foam-300 transition-colors text-sm w-fit focus:outline-none focus-visible:ring-2 focus-visible:ring-foam-400 rounded-sm"
              >
                Market Insights
              </Link>
              <FooterPortalLink />
              <Link
                href="/contact"
                className="text-ocean-200/80 hover:text-foam-300 transition-colors text-sm w-fit focus:outline-none focus-visible:ring-2 focus-visible:ring-foam-400 rounded-sm"
              >
                Contact Us
              </Link>
            </nav>
          </div>

          {/* Contact Info */}
          <div className="col-span-4 max-[1024px]:col-span-1 space-y-6">
            <h3 className="text-white font-semibold text-sm uppercase tracking-wider">
              Contact Info
            </h3>
            <address className="not-italic space-y-4">
              <div className="flex items-start space-x-3 text-sm">
                <Phone
                  className="h-5 w-5 text-foam-400 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="flex flex-col space-y-2">
                  <a
                    href="tel:+201010329231"
                    className="text-ocean-200/80 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foam-400 rounded-sm w-fit"
                  >
                    +20 101 032 9231{" "}
                    <span className="text-ocean-400 text-xs ml-1">(Egypt)</span>
                  </a>
                  <a
                    href="tel:+971509296756"
                    className="text-ocean-200/80 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foam-400 rounded-sm w-fit"
                  >
                    +971 50 929 6756{" "}
                    <span className="text-ocean-400 text-xs ml-1">(UAE)</span>
                  </a>
                </div>
              </div>
              <div className="flex items-center space-x-3 text-sm">
                <Mail
                  className="h-5 w-5 text-foam-400 shrink-0"
                  aria-hidden="true"
                />
                <a
                  href="mailto:info@arabshipbroker.com"
                  className="text-ocean-200/80 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foam-400 rounded-sm break-all"
                >
                  info@arabshipbroker.com
                </a>
              </div>
              <div className="flex items-start space-x-3 text-sm">
                <MapPin
                  className="h-5 w-5 text-foam-400 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span className="text-ocean-200/80 leading-relaxed max-w-xs">
                  5th Settlement, New Cairo, Egypt
                  <span className="block text-ocean-400 text-xs mt-0.5">
                    (Office under set up)
                  </span>
                </span>
              </div>
            </address>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-ocean-800/50 mt-12 pt-8 flex justify-between items-center gap-4 text-left max-[1024px]:flex-col max-[1024px]:items-start max-[768px]:items-center max-[768px]:text-center">
          <p className="text-ocean-400 text-sm">
            © {currentYear} Arab ShipBroker. All rights reserved.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 max-[1024px]:justify-start max-[768px]:justify-center">
            <Link
              href="/legal"
              className="text-ocean-400 hover:text-white text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foam-400 rounded-sm"
            >
              Legal Notes
            </Link>
            <Link
              href="/terms"
              className="text-ocean-400 hover:text-white text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foam-400 rounded-sm"
            >
              Terms & Conditions
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function LinkedinIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}
