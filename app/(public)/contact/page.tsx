"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  MapPin,
  Phone,
  Mail,
  Send,
  Anchor,
  ArrowRight,
  User,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { sendMessage } from "@/sdk/app/contact";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const contactSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number must be at least 10 characters"),
  howDidYouFindUs: z.string().min(1, "Please select how you found us"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

type ContactFormData = z.infer<typeof contactSchema>;

const contactInfo = [
  {
    icon: Phone,
    label: "Phone Numbers",
    details: ["+20 101 032 9231 (Egypt)", "+971 50 929 6756 (UAE)"],
  },
  {
    icon: Mail,
    label: "Email Address",
    details: [
      "General: info@arabshipbroker.com",
      "Circulation: circ@arabshipbroker.com",
    ],
  },
  {
    icon: MapPin,
    label: "Office Address",
    details: [
      "Regus Business Centre, W51 Plot 242/243",
      "5th Settlement, New Cairo, Egypt",
    ],
  },
];

export default function ContactPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      howDidYouFindUs: "",
      message: "",
    },
  });

  const onSubmit = async (data: ContactFormData) => {
    setIsSubmitting(true);
    const supabase = getSupabaseBrowserClient();

    try {
      await sendMessage(supabase, {
        name: data.name,
        email: data.email,
        phone: data.phone,
        how_did_you_find_us: data.howDidYouFindUs,
        message: data.message,
      });

      toast.success(
        "Message sent successfully! We'll get back to you within 24 hours.",
      );
      form.reset();
    } catch (error) {
      console.error("Form submission error:", error);
      toast.error("Failed to send message. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col w-full overflow-hidden bg-slate-50">
      <section className="relative pt-40 pb-32 max-[1024px]:pt-32 max-[1024px]:pb-24 max-[768px]:pt-24 max-[768px]:pb-20 bg-ocean-950 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(43,185,211,0.15),transparent_70%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-overlay pointer-events-none" />

        <div className="container relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="max-w-4xl mx-auto"
          >
            <span className="inline-block text-xs font-bold tracking-widest uppercase mb-6 px-4 py-1.5 rounded-full bg-white/10 text-foam-300 border border-white/10 backdrop-blur-md">
              Get In Touch
            </span>
            <h1 className="text-6xl max-[1024px]:text-5xl max-[768px]:text-4xl font-bold text-white mb-6 leading-tight tracking-tight drop-shadow-lg">
              Let&apos;s Discuss Your <br />
              <span className="text-foam-300">Maritime Needs</span>
            </h1>
            <p className="text-xl max-[768px]:text-lg text-ocean-100/90 leading-relaxed max-w-2xl mx-auto drop-shadow">
              Whether you have an inquiry, need market insights, or want to
              charter a vessel, our expert team is ready to navigate the
              solutions with you.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 relative z-20 -mt-10">
        <div className="container">
          <div className="grid grid-cols-12 max-[1024px]:grid-cols-1 gap-16 max-[1024px]:gap-10">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="col-span-7 max-[1024px]:col-span-1"
            >
              <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-10 max-[768px]:p-6 border border-slate-200/60 h-full">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-12 h-12 bg-ocean-50 rounded-2xl flex items-center justify-center">
                    <MessageSquare className="w-6 h-6 text-ocean-600" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-ocean-900 tracking-tight">
                      Send a Message
                    </h2>
                    <p className="text-slate-500 text-sm mt-1">
                      We typically respond within 24 hours.
                    </p>
                  </div>
                </div>

                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-5"
                  >
                    <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-5">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-slate-700 font-semibold text-xs uppercase tracking-wider">
                              Full Name *
                            </FormLabel>
                            <FormControl>
                              <div className="relative group">
                                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 group-focus-within:text-ocean-500 transition-colors" />
                                <Input
                                  disabled={isSubmitting}
                                  placeholder="Capt. John Doe"
                                  className="bg-slate-50 border-slate-200 focus:bg-white focus:border-ocean-500 focus:ring-2 focus:ring-ocean-500/20 pl-10 h-12 transition-all rounded-xl"
                                  {...field}
                                />
                              </div>
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-slate-700 font-semibold text-xs uppercase tracking-wider">
                              Phone Number *
                            </FormLabel>
                            <FormControl>
                              <div className="relative group">
                                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 group-focus-within:text-ocean-500 transition-colors" />
                                <Input
                                  disabled={isSubmitting}
                                  placeholder="+20 101 032 9231"
                                  className="bg-slate-50 border-slate-200 focus:bg-white focus:border-ocean-500 focus:ring-2 focus:ring-ocean-500/20 pl-10 h-12 transition-all rounded-xl"
                                  {...field}
                                />
                              </div>
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-700 font-semibold text-xs uppercase tracking-wider">
                            Email Address *
                          </FormLabel>
                          <FormControl>
                            <div className="relative group">
                              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 group-focus-within:text-ocean-500 transition-colors" />
                              <Input
                                disabled={isSubmitting}
                                type="email"
                                placeholder="captain@company.com"
                                className="bg-slate-50 border-slate-200 focus:bg-white focus:border-ocean-500 focus:ring-2 focus:ring-ocean-500/20 pl-10 h-12 transition-all rounded-xl"
                                {...field}
                              />
                            </div>
                          </FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="howDidYouFindUs"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-700 font-semibold text-xs uppercase tracking-wider">
                            How did you find us? *
                          </FormLabel>
                          <Select
                            disabled={isSubmitting}
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="bg-slate-50 border-slate-200 focus:bg-white focus:border-ocean-500 focus:ring-2 focus:ring-ocean-500/20 h-12 transition-all rounded-xl">
                                <SelectValue placeholder="Select an option" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-white border border-slate-200 shadow-xl rounded-xl">
                              <SelectItem
                                value="google"
                                className="cursor-pointer hover:bg-slate-50"
                              >
                                Google Search
                              </SelectItem>
                              <SelectItem
                                value="referral"
                                className="cursor-pointer hover:bg-slate-50"
                              >
                                Referral
                              </SelectItem>
                              <SelectItem
                                value="linkedin"
                                className="cursor-pointer hover:bg-slate-50"
                              >
                                LinkedIn
                              </SelectItem>
                              <SelectItem
                                value="industry-contact"
                                className="cursor-pointer hover:bg-slate-50"
                              >
                                Industry Contact
                              </SelectItem>
                              <SelectItem
                                value="conference"
                                className="cursor-pointer hover:bg-slate-50"
                              >
                                Conference/Event
                              </SelectItem>
                              <SelectItem
                                value="other"
                                className="cursor-pointer hover:bg-slate-50"
                              >
                                Other
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="message"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-700 font-semibold text-xs uppercase tracking-wider">
                            Message *
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              disabled={isSubmitting}
                              placeholder="Tell us about your shipping requirements or any questions you may have..."
                              className="bg-slate-50 border-slate-200 focus:bg-white focus:border-ocean-500 focus:ring-2 focus:ring-ocean-500/20 p-4 transition-all rounded-xl min-h-35 resize-none"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )}
                    />

                    <div className="pt-4 space-y-4">
                      <Button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full h-14 bg-ocean-600 hover:bg-ocean-700 text-white rounded-xl font-semibold text-base shadow-lg shadow-ocean-600/20 transition-all flex items-center justify-center group"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="animate-spin mr-2 w-5 h-5" />
                            Dispatching...
                          </>
                        ) : (
                          <>
                            Send Message
                            <Send className="w-5 h-5 ml-2 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                          </>
                        )}
                      </Button>

                      <p className="text-center text-xs text-slate-500">
                        By submitting, you agree to our{" "}
                        <Link
                          href="/legal"
                          className="text-ocean-600 hover:text-ocean-700 font-medium hover:underline underline-offset-4"
                        >
                          Legal Notes
                        </Link>{" "}
                        and{" "}
                        <Link
                          href="/terms"
                          className="text-ocean-600 hover:text-ocean-700 font-medium hover:underline underline-offset-4"
                        >
                          Terms
                        </Link>
                        .
                      </p>
                    </div>
                  </form>
                </Form>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="col-span-5 max-[1024px]:col-span-1 space-y-8"
            >
              <div className="space-y-4">
                {contactInfo.map((info, index) => (
                  <div
                    key={index}
                    className="bg-white rounded-2xl p-6 max-[768px]:p-5 border border-slate-200/60 shadow-lg shadow-slate-200/40 flex items-start gap-4 hover:-translate-y-1 transition-transform duration-300"
                  >
                    <div className="w-12 h-12 bg-ocean-50 text-ocean-600 rounded-xl flex items-center justify-center shrink-0">
                      <info.icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-ocean-900 mb-2">
                        {info.label}
                      </h3>
                      <div className="space-y-1">
                        {info.details.map((detail, i) => (
                          <p
                            key={i}
                            className="text-slate-600 text-sm leading-relaxed"
                          >
                            {detail}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-2xl p-2 border border-slate-200/60 shadow-lg shadow-slate-200/40">
                <div className="w-full h-80 max-[1024px]:h-72 max-[768px]:h-56 rounded-xl overflow-hidden bg-slate-100">
                  <iframe
                    src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d110502.61185040685!2d31.4332924!3d30.0596185!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x145818006e8b4e75%3A0xc343360b6168e3d3!2sNew%20Cairo%20City%2C%20Cairo%20Governorate%2C%20Egypt!5e0!3m2!1sen!2sus!4v1714589252000!5m2!1sen!2sus"
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    title="Arab ShipBroker Location"
                    className="w-full h-full"
                  />
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-24 max-[768px]:py-20 bg-white border-t border-slate-100">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto"
          >
            <div className="relative bg-slate-50 rounded-[2.5rem] shadow-xl border border-slate-200/60 overflow-hidden">
              <div className="h-2 bg-linear-to-r from-ocean-600 via-foam-400 to-ocean-600" />

              <div className="p-14 max-[1024px]:p-10 max-[768px]:p-8 flex flex-row max-[1024px]:flex-col items-center max-[1024px]:items-start max-[768px]:items-center gap-10">
                <div className="shrink-0 relative">
                  <div className="w-40 h-40 max-[768px]:w-32 max-[768px]:h-32 rounded-3xl overflow-hidden shadow-2xl border-4 border-white rotate-2 max-[768px]:rotate-0 hover:rotate-0 transition-transform duration-500">
                    <Image
                      src="/cp.jpeg"
                      alt="Capt. Mohamed Dawoud"
                      className="w-full h-full object-cover"
                      width={160}
                      height={160}
                    />
                  </div>
                  <div className="absolute -bottom-3 -right-3 w-12 h-12 max-[768px]:w-10 max-[768px]:h-10 bg-ocean-600 rounded-2xl flex items-center justify-center shadow-xl border-4 border-white">
                    <Anchor className="w-5 h-5 max-[768px]:w-4 max-[768px]:h-4 text-white" />
                  </div>
                </div>

                <div className="flex-1 text-left max-[1024px]:text-center">
                  <h3 className="text-3xl max-[768px]:text-2xl font-bold text-ocean-900 tracking-tight mb-2">
                    Mohamed Dawoud
                  </h3>
                  <p className="text-ocean-600 font-bold tracking-wide uppercase text-sm mb-2">
                    Dry Bulk Broker & Co-Founder
                  </p>
                  <p className="text-slate-500 text-sm font-medium mb-6">
                    Capt., BSc., MSc. &ldquo;Fleet Ops.&rdquo;
                  </p>
                  <div className="w-16 h-1 bg-foam-300 rounded-full mb-6 mx-0 max-[1024px]:mx-auto" />
                  <p className="text-slate-600 text-base leading-relaxed mb-8">
                    With a Master&apos;s in Fleet Operations, a Master Mariner
                    License, and over 15 years of combined sea and shore
                    experience, Capt. Mohamed leads Arab ShipBroker with
                    hands-on maritime expertise. Reach out directly. He&apos;s
                    always happy to discuss your shipping needs.
                  </p>
                  <Button
                    asChild
                    variant="outline"
                    className="border-slate-300 text-ocean-700 hover:bg-ocean-50 hover:border-ocean-200 transition-all rounded-xl h-12 px-8 max-[768px]:w-full group"
                  >
                    <a
                      href="https://www.linkedin.com/in/cpt-mohamed-dawoud"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mr-3 text-ocean-600"
                      >
                        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                        <rect width="4" height="12" x="2" y="9" />
                        <circle cx="4" cy="4" r="2" />
                      </svg>
                      Connect on LinkedIn
                      <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 group-hover:ml-2 transition-all absolute right-4" />
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
