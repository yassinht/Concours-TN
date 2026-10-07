import {
  Brain, Briefcase, Dumbbell, Factory, FileSearch, GraduationCap, Landmark, Medal, Mic, PenLine, School, Shield, Ship, Stethoscope, Users, Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Field, PhaseKind } from '@ctn/shared';

const FIELD_ICONS: Record<Field, LucideIcon> = {
  SECURITY: Shield,
  CUSTOMS: Ship,
  EDUCATION: GraduationCap,
  HEALTH: Stethoscope,
  FINANCE: Landmark,
  PUBLIC_COMPANY: Factory,
  ADMINISTRATION: Briefcase,
  DEFENSE: Medal,
  TECHNICAL: Wrench,
};

const PHASE_ICONS: Record<PhaseKind, LucideIcon> = {
  WRITTEN: PenLine,
  PHYSICAL: Dumbbell,
  ORAL: Mic,
  PSYCHOTECH: Brain,
  MEDICAL: Stethoscope,
  FILE_REVIEW: FileSearch,
  INTERVIEW: Users,
  TRAINING: School,
};

export function FieldIcon({ field, className = 'size-5' }: { field: Field; className?: string }) {
  const Icon = FIELD_ICONS[field] ?? Briefcase;
  return <Icon className={className} aria-hidden />;
}

export function PhaseIcon({ kind, className = 'size-4' }: { kind: PhaseKind; className?: string }) {
  const Icon = PHASE_ICONS[kind] ?? PenLine;
  return <Icon className={className} aria-hidden />;
}
