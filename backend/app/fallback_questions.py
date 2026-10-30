"""Template question set used ONLY when Gemini is temporarily unavailable.

Questions come from fixed per-category banks plus skill-specific templates
filled with skills detected (by keyword matching, not AI) in the supplied job
description and resume. Callers must label the result as a template fallback;
nothing here is Gemini output.
"""

from __future__ import annotations

import re
from typing import Dict, List

# Skills that make poor "walk me through a project using X" questions.
_SOFT_OR_GENERIC = {"communication", "problem solving", "agile", "git", "github", "testing", "gemini"}

# Skills most worth asking about first, per category.
_CATEGORY_SKILLS = {
    "AI / Machine Learning": ["machine learning", "pytorch", "tensorflow", "llm", "generative ai", "pandas", "numpy", "spark", "python"],
    "Backend Development": ["fastapi", "django", "flask", "node.js", "rest api", "graphql", "sql", "postgresql", "mysql", "mongodb", "redis", "kafka", "microservices"],
    "Frontend Development": ["react", "javascript", "typescript", "html", "css"],
    "Full-Stack Development": ["react", "node.js", "rest api", "mongodb", "sql", "typescript", "javascript"],
    "System Design": ["microservices", "kafka", "redis", "kubernetes", "aws", "gcp", "azure", "observability"],
}

_DISPLAY = {
    "python": "Python",
    "java": "Java",
    "react": "React",
    "django": "Django",
    "flask": "Flask",
    "docker": "Docker",
    "kubernetes": "Kubernetes",
    "redis": "Redis",
    "kafka": "Kafka",
    "spark": "Spark",
    "linux": "Linux",
    "llm": "large language models",
    "generative ai": "generative AI",
    "machine learning": "machine learning",
    "tensorflow": "TensorFlow",
    "pytorch": "PyTorch",
    "numpy": "NumPy",
    "pandas": "pandas",
    "sql": "SQL",
    "postgresql": "PostgreSQL",
    "mysql": "MySQL",
    "mongodb": "MongoDB",
    "aws": "AWS",
    "gcp": "Google Cloud",
    "azure": "Azure",
    "ci/cd": "CI/CD",
    "rest api": "REST APIs",
    "graphql": "GraphQL",
    "node.js": "Node.js",
    "javascript": "JavaScript",
    "typescript": "TypeScript",
    "fastapi": "FastAPI",
    "html": "HTML",
    "css": "CSS",
    "c++": "C++",
}

SKILL_TEMPLATES = [
    "Walk me through a project where you used {skill}. What problem did it solve, what was your part, and what would you do differently?",
    "How would you explain {skill} to a teammate who has never used it, and what is a common mistake people make with it?",
]

BANK: Dict[str, List[str]] = {
    "AI / Machine Learning": [
        "Explain the bias-variance trade-off and how you would tell whether a model is overfitting or underfitting.",
        "Your classification dataset has only 2 percent positive examples. How would you train and evaluate a model on it?",
        "What is data leakage? Give an example of how it can happen and how you would prevent it.",
        "How do you choose between precision, recall, F1 and ROC-AUC for a given problem?",
        "Walk me through how you would take a trained model to production and monitor it for drift.",
        "How would you decide between a simple baseline model and a deep learning model for a new problem?",
        "Explain how cross-validation works and when a simple train-test split is not enough.",
        "How does retrieval-augmented generation work, and when would you use it instead of fine-tuning a language model?",
        "Describe how you would design features for a model that predicts customer churn.",
        "How would you explain a model's predictions to a non-technical stakeholder?",
    ],
    "Data Structures and Algorithms": [
        "Explain the difference between an array and a linked list, and when you would choose each.",
        "How does a hash map work internally, and what happens when two keys collide?",
        "Describe how you would detect a cycle in a linked list and analyse the time and space complexity.",
        "When would you use breadth-first search instead of depth-first search?",
        "Explain how binary search works and the edge cases that commonly cause bugs.",
        "How would you find the k largest elements in a large stream of numbers?",
        "What is dynamic programming? Explain it using a problem you have solved.",
        "Compare quicksort and merge sort in terms of complexity, stability and memory use.",
    ],
    "System Design": [
        "Design a URL shortener. Cover the data model, API, scaling and how you would avoid collisions.",
        "How would you design a rate limiter for a public API?",
        "Explain how you would add caching to a read-heavy service and how you would keep the cache correct.",
        "How would you design a notification system that sends email and push messages to millions of users?",
        "When would you choose a relational database over a NoSQL database, and why?",
        "How would you make a service highly available across multiple regions?",
        "Explain how a message queue helps decouple services, with an example.",
        "How would you design pagination for an API that returns millions of records?",
    ],
    "Backend Development": [
        "What makes a REST API endpoint idempotent, and why does it matter for retries?",
        "How would you design authentication and authorisation for a backend API?",
        "Walk me through how you would find and fix a slow database query in production.",
        "How do you securely store user passwords, and why?",
        "What happens, step by step, when a client calls your API and the database is temporarily unavailable?",
        "How would you validate input and return consistent errors across an API?",
        "Explain database transactions and an example of a race condition they prevent.",
        "How would you design logging and monitoring for a backend service?",
    ],
    "Frontend Development": [
        "Explain how the browser renders a page and what causes layout thrashing.",
        "How do you manage state in a large single-page application?",
        "What steps would you take to make a web page accessible to keyboard and screen-reader users?",
        "How would you diagnose and improve a slow-loading web page?",
        "Explain the difference between client-side and server-side rendering and when to use each.",
        "How do you prevent cross-site scripting in a frontend application?",
        "How would you design a reusable, accessible form component?",
        "Explain how you would handle loading, error and empty states for data fetched from an API.",
    ],
    "Full-Stack Development": [
        "Walk me through a request from the browser to the database and back in an application you built.",
        "How would you design authentication that works securely across a frontend and a backend?",
        "How do you keep the API contract between frontend and backend in sync?",
        "Where would you put validation in a full-stack app, and why?",
        "How would you deploy a full-stack application and handle environment configuration?",
        "Describe how you would debug a bug that appears only in production.",
        "How would you add real-time updates to an existing web application?",
        "How would you structure a project so that frontend and backend can evolve independently?",
    ],
    "Software Development / SDE": [
        "Explain the SOLID principles and give an example of one you applied.",
        "How do you approach writing tests for code you have just written?",
        "Describe how you would review a teammate's pull request.",
        "Explain the difference between a process and a thread.",
        "How would you refactor a large function that has become hard to change?",
        "What is the difference between concurrency and parallelism?",
        "How do you decide when code is ready to ship?",
        "Explain how version control branching works in a team you have been part of.",
    ],
    "Behavioral": [
        "Tell me about a time you disagreed with a teammate. How did you resolve it?",
        "Describe a time you missed a deadline or made a mistake. What did you learn?",
        "Tell me about a time you had to learn something new quickly.",
        "Describe a situation where you took ownership of a problem nobody else was handling.",
        "Tell me about a time you received critical feedback and how you responded.",
        "Describe a project where you had to work with unclear requirements.",
        "Tell me about a time you helped a teammate succeed.",
        "Describe a time you had to prioritise between several urgent tasks.",
    ],
    "General HR": [
        "Tell me about yourself and why you are interested in this role.",
        "What are your strengths, and what is one area you are working to improve?",
        "Where do you see yourself in the next three years?",
        "Why do you want to work at a company like ours?",
        "What kind of work environment helps you do your best work?",
        "How do you handle pressure and tight deadlines?",
        "What motivates you in your work?",
        "Is there anything on your resume you would like to explain further?",
    ],
}
BANK["Resume-Based Interview"] = [
    "Pick the project on your resume you are proudest of. Explain the architecture and your personal contribution.",
    "Choose one bullet point from your resume and explain exactly what you implemented and the trade-offs you considered.",
    "Which experience on your resume best prepares you for this role, and why?",
    "Describe the hardest technical problem from a project on your resume and how you solved it.",
    "What would you improve if you rebuilt one of your resume projects today?",
    "Tell me about a time a project on your resume did not go as planned.",
]
BANK["Job Description-Based Interview"] = [
    "Which requirement in this job description do you match best, and what evidence can you give?",
    "Which requirement in this job description is newest to you, and how would you get up to speed?",
    "What do you expect your first 90 days in this role to look like?",
    "Which responsibility in this posting do you think is most challenging, and how would you approach it?",
    "Describe how your past work relates to the main responsibilities in this job description.",
    "What questions would you ask the team to understand this role better?",
]

UNIVERSAL = [
    "Give me a one-minute introduction focused on the experience most relevant to this role.",
    "Tell me about a challenging technical problem you solved and how you approached it.",
    "Describe a time you had to learn a new technology quickly. How did you check that your solution worked?",
    "How do you explain a technical idea to someone without a technical background?",
    "Tell me about a project you are proud of and the impact it had.",
    "How do you handle ambiguity when requirements are unclear?",
    "Describe a time you worked in a team to deliver something under a deadline.",
    "What is one mistake you made in a project and what did you change afterwards?",
    "How do you stay current with developments in your field?",
    "Why are you a strong fit for this role?",
    "How do you prioritise when you have several tasks due at the same time?",
    "What would you like to learn in your first months in this role?",
]

_MIXED_ORDER = ["General HR", "Software Development / SDE", "Data Structures and Algorithms", "Behavioral", "System Design", "Backend Development", "Frontend Development", "AI / Machine Learning"]


def _norm(q: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", q.lower()).strip()


def build_fallback_questions(category: str, difficulty: str, count: int, jd_skills: List[str], resume_skills: List[str], avoid: List[str] = ()) -> List[Dict[str, str]]:
    """Exactly `count` distinct template questions, personalised by detected skills."""
    items: List[Dict[str, str]] = []
    seen = {_norm(q) for q in avoid}

    def add(question: str, cat: str, topic: str) -> None:
        key = _norm(question)
        if key not in seen and len(items) < count:
            seen.add(key)
            items.append({"question": question, "category": cat, "topic": topic, "difficulty": difficulty})

    target_category = category if category != "Mixed Interview" else None
    skills = [s for s in dict.fromkeys(jd_skills + resume_skills) if s not in _SOFT_OR_GENERIC]
    preferred = _CATEGORY_SKILLS.get(category, [])
    skills.sort(key=lambda s: preferred.index(s) if s in preferred else len(preferred))  # stable: JD order otherwise
    # About a third of the set comes from skills in the supplied job description/resume.
    for i, skill in enumerate(skills[: max(1, count // 3)]):
        add(SKILL_TEMPLATES[i % len(SKILL_TEMPLATES)].format(skill=_DISPLAY.get(skill, skill)), target_category or "Mixed Interview", skill)

    if target_category:
        for q in BANK.get(target_category, []):
            add(q, target_category, "template")
    else:
        # Mixed: round-robin across categories.
        pools = [list(BANK[c]) for c in _MIXED_ORDER]
        while len(items) < count and any(pools):
            for cat, pool in zip(_MIXED_ORDER, pools):
                if pool:
                    add(pool.pop(0), cat, "template")
    for q in UNIVERSAL:
        add(q, target_category or "General HR", "template")
    # Narrow categories (resume/JD-based) can still be short at 20: top up with general questions.
    for cat in ("General HR", "Behavioral"):
        for q in BANK[cat]:
            add(q, target_category or cat, "template")
    return items
