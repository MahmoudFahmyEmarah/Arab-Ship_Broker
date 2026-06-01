"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  User,
  Mail,
  Lock,
  Package,
  Ship,
  Eye,
  EyeOff,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  updateBasicInfo,
  updateProfileInfo,
  requestEmailChange,
  updatePassword,
} from "@/app/(dashboard)/dashboard/account/actions";

type ProfileFields = {
  display_name: string;
  company: string;
  phone: string;
  notes: string;
};

interface AccountEditFormProps {
  initialValues: {
    full_name: string;
    email: string;
    cargo: ProfileFields | null;
    vessel: ProfileFields | null;
  };
}

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-100">
        <div className="w-9 h-9 rounded-xl bg-ocean-50 border border-ocean-100 flex items-center justify-center shrink-0">
          <Icon className="w-4.5 h-4.5 text-ocean-600" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-800">{title}</p>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
      {children}
    </label>
  );
}

const inputCls =
  "w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all";

function SaveButton({
  isPending,
  label = "Save changes",
}: {
  isPending: boolean;
  label?: string;
}) {
  return (
    <button
      type="submit"
      disabled={isPending}
      className="flex items-center gap-2 px-5 py-2.5 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold text-sm rounded-xl transition-colors disabled:opacity-60 shadow-sm"
    >
      {isPending ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
        </>
      ) : (
        <>
          <CheckCircle className="w-3.5 h-3.5" /> {label}
        </>
      )}
    </button>
  );
}

function ProfileSection({
  type,
  initial,
}: {
  type: "cargo" | "vessel";
  initial: ProfileFields;
}) {
  const [fields, setFields] = useState<ProfileFields>(initial);
  const [isPending, startTransition] = useTransition();

  const set =
    (key: keyof ProfileFields) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFields((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateProfileInfo(type, fields);
      if (result.success) {
        toast.success(
          `${type === "cargo" ? "Cargo" : "Vessel"} profile updated.`,
        );
      } else {
        toast.error(result.error);
      }
    });
  };

  const Icon = type === "cargo" ? Package : Ship;
  const label = type === "cargo" ? "Cargo profile" : "Vessel profile";

  return (
    <SectionCard
      icon={Icon}
      title={label}
      subtitle="Shown on your listings and to potential counterparts."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 max-[640px]:grid-cols-1 gap-4">
          <div>
            <FieldLabel>Display name</FieldLabel>
            <input
              value={fields.display_name}
              onChange={set("display_name")}
              placeholder="e.g. Gulf Maritime LLC"
              className={inputCls}
            />
          </div>
          <div>
            <FieldLabel>Company</FieldLabel>
            <input
              value={fields.company}
              onChange={set("company")}
              placeholder="e.g. Gulf Maritime LLC"
              className={inputCls}
            />
          </div>
          <div>
            <FieldLabel>Phone</FieldLabel>
            <input
              value={fields.phone}
              onChange={set("phone")}
              placeholder="e.g. +971 4 000 0000"
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <FieldLabel>Notes</FieldLabel>
          <textarea
            value={fields.notes}
            onChange={set("notes")}
            rows={2}
            placeholder="Any additional info about your company or activity…"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 focus:bg-white transition-all resize-none"
          />
        </div>
        <div className="flex justify-end">
          <SaveButton isPending={isPending} />
        </div>
      </form>
    </SectionCard>
  );
}

export function AccountEditForm({ initialValues }: AccountEditFormProps) {
  const [fullName, setFullName] = useState(initialValues.full_name);
  const [isPendingBasic, startBasic] = useTransition();

  const [newEmail, setNewEmail] = useState("");
  const [isPendingEmail, startEmail] = useTransition();

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [isPendingPw, startPw] = useTransition();

  const handleBasicSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    startBasic(async () => {
      const result = await updateBasicInfo(fullName);
      if (result.success) toast.success("Name updated.");
      else toast.error(result.error);
    });
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    startEmail(async () => {
      const result = await requestEmailChange(newEmail);
      if (result.success) {
        toast.success(
          "Confirmation links sent to both your old and new email. Follow the links to complete the change.",
        );
        setNewEmail("");
      } else {
        toast.error(result.error);
      }
    });
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPw || !newPw) return;
    if (newPw.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    startPw(async () => {
      const result = await updatePassword(currentPw, newPw);
      if (result.success) {
        toast.success("Password changed successfully.");
        setCurrentPw("");
        setNewPw("");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      <SectionCard
        icon={User}
        title="Personal information"
        subtitle="Your name as shown across the platform."
      >
        <form onSubmit={handleBasicSubmit} className="space-y-4">
          <div>
            <FieldLabel>Full name</FieldLabel>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your full name"
              className={inputCls}
              required
            />
          </div>
          <div>
            <FieldLabel>Email (read-only)</FieldLabel>
            <input
              value={initialValues.email}
              readOnly
              className={cn(inputCls, "text-slate-400 cursor-not-allowed")}
            />
            <p className="text-xs text-slate-400 mt-1">
              To change your email, use the Email section below.
            </p>
          </div>
          <div className="flex justify-end">
            <SaveButton isPending={isPendingBasic} />
          </div>
        </form>
      </SectionCard>

      {initialValues.cargo && (
        <ProfileSection type="cargo" initial={initialValues.cargo} />
      )}
      {initialValues.vessel && (
        <ProfileSection type="vessel" initial={initialValues.vessel} />
      )}

      <SectionCard
        icon={Mail}
        title="Change email"
        subtitle="Requires confirmation from both your old and new email address."
      >
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div>
            <FieldLabel>New email address</FieldLabel>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="new@example.com"
              className={inputCls}
              required
            />
          </div>
          <div className="flex justify-end">
            <SaveButton isPending={isPendingEmail} label="Send confirmation" />
          </div>
        </form>
      </SectionCard>

      <SectionCard
        icon={Lock}
        title="Change password"
        subtitle="You must confirm your current password before setting a new one."
      >
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div>
            <FieldLabel>Current password</FieldLabel>
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="••••••••"
                className={cn(inputCls, "pr-10")}
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showCurrent ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
          <div>
            <FieldLabel>New password</FieldLabel>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="Min. 8 characters"
                className={cn(inputCls, "pr-10")}
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showNew ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {newPw.length > 0 && newPw.length < 8 && (
              <p className="text-xs text-red-500 mt-1">
                Password must be at least 8 characters.
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <SaveButton isPending={isPendingPw} label="Change password" />
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
