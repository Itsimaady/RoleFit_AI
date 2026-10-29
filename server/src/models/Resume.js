import mongoose from 'mongoose';

export const RESUME_TEMPLATES = ['classic', 'modern', 'compact'];

const { Schema } = mongoose;
const str = (max, extra = {}) => ({ type: String, trim: true, maxlength: max, default: '', ...extra });
const list = (max, itemMax) => ({
  type: [{ type: String, trim: true, maxlength: itemMax }],
  default: [],
  validate: { validator: (v) => v.length <= max, message: `At most ${max} items allowed` },
});
const entries = (schema, max) => ({
  type: [schema],
  default: [],
  validate: { validator: (v) => v.length <= max, message: `At most ${max} entries allowed` },
});

const educationSchema = new Schema(
  {
    institution: str(150),
    degree: str(120),
    field: str(120),
    location: str(120),
    startDate: str(30),
    endDate: str(30),
    grade: str(40),
    details: str(500),
  },
  { _id: true },
);

const experienceSchema = new Schema(
  {
    role: str(120),
    organization: str(150),
    location: str(120),
    type: str(40),
    startDate: str(30),
    endDate: str(30),
    current: { type: Boolean, default: false },
    bullets: list(12, 400),
  },
  { _id: true },
);

const projectSchema = new Schema(
  {
    name: str(150),
    role: str(120),
    technologies: list(25, 50),
    link: str(300),
    startDate: str(30),
    endDate: str(30),
    bullets: list(10, 400),
  },
  { _id: true },
);

const certificationSchema = new Schema({ name: str(150), issuer: str(150), date: str(30), link: str(300) }, { _id: true });
const achievementSchema = new Schema({ title: str(150), description: str(400), date: str(30) }, { _id: true });
const linkSchema = new Schema({ label: str(60), url: str(300) }, { _id: true });

const resumeSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    template: { type: String, enum: RESUME_TEMPLATES, default: 'classic' },
    personal: {
      fullName: str(80),
      headline: str(120),
      email: str(254),
      phone: str(40),
      location: str(120),
      website: str(300),
      linkedin: str(300),
      github: str(300),
    },
    summary: str(1500),
    education: entries(educationSchema, 10),
    experience: entries(experienceSchema, 15),
    projects: entries(projectSchema, 15),
    skills: {
      technical: list(60, 50),
      interpersonal: list(30, 50),
    },
    certifications: entries(certificationSchema, 20),
    achievements: entries(achievementSchema, 20),
    links: entries(linkSchema, 10),
    // Optimistic concurrency token: incremented on every save so stale
    // autosaves from another tab cannot silently overwrite newer content.
    revision: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true },
);

resumeSchema.index({ owner: 1, updatedAt: -1 });

export const Resume = mongoose.model('Resume', resumeSchema);
