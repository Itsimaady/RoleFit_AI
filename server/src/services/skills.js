// Canonical skill dictionary used by the rule-based matcher.
// Each entry: canonical label, category, and one or more regex sources that are
// matched against normalized (lower-case) text with technology-aware boundaries.

const B = '(?<![a-z0-9+#])'; // left boundary
const E = '(?![a-z0-9+#])'; // right boundary

const entries = [
  // Languages
  ['Python', 'language', ['python']],
  ['Java', 'language', ['java']],
  ['JavaScript', 'language', ['javascript', 'es6', 'ecmascript']],
  ['TypeScript', 'language', ['typescript']],
  ['C++', 'language', ['c\\+\\+', 'cpp']],
  ['C#', 'language', ['c#', 'c sharp', 'csharp']],
  ['Go', 'language', ['golang', 'go lang']],
  ['Rust', 'language', ['rust']],
  ['Kotlin', 'language', ['kotlin']],
  ['Swift', 'language', ['swift']],
  ['PHP', 'language', ['php']],
  ['Ruby', 'language', ['ruby']],
  ['Scala', 'language', ['scala']],
  ['R', 'language', ['r programming', 'r language', 'rstudio']],
  ['SQL', 'language', ['sql']],
  ['HTML', 'frontend', ['html5?']],
  ['CSS', 'frontend', ['css3?']],
  ['Bash', 'tooling', ['bash', 'shell scripting', 'shell scripts?']],
  // Frontend
  ['React', 'frontend', ['react(?:\\.?js)?', 'react native']],
  ['Angular', 'frontend', ['angular(?:js)?']],
  ['Vue.js', 'frontend', ['vue(?:\\.?js)?']],
  ['Next.js', 'frontend', ['next\\.?js']],
  ['Redux', 'frontend', ['redux']],
  ['Tailwind CSS', 'frontend', ['tailwind(?: css)?']],
  ['Bootstrap', 'frontend', ['bootstrap']],
  ['Vite', 'frontend', ['vite']],
  ['Responsive design', 'frontend', ['responsive (?:web )?design', 'mobile-first']],
  ['Accessibility', 'frontend', ['accessibility', 'a11y', 'wcag']],
  // Backend
  ['Node.js', 'backend', ['node(?:\\.?js)?']],
  // Bare "Express" only counts next to stack terms, so the verb "express" is ignored.
  ['Express.js', 'backend', [
    'express(?:\\.?js| js)',
    'express framework',
    'express(?=[\\s,/+&]+(?:and |with )?(?:mongo|node|react|rest|api|backend|server|mern))',
    '(?<=(?:node(?:\\.?js)?|mongo(?:db)?|react(?:\\.?js)?)[\\s,/+&]+(?:and )?)express',
  ]],
  ['FastAPI', 'backend', ['fastapi']],
  ['Django', 'backend', ['django']],
  ['Flask', 'backend', ['flask']],
  ['Spring Boot', 'backend', ['spring boot', 'spring framework', 'spring mvc']],
  ['.NET', 'backend', ['\\.net', 'asp\\.net', 'dotnet']],
  ['REST APIs', 'backend', ['rest(?:ful)? ?apis?', 'rest(?:ful)? (?:web )?services?', 'restful']],
  ['GraphQL', 'backend', ['graphql']],
  ['gRPC', 'backend', ['grpc']],
  ['Microservices', 'backend', ['micro-?services?']],
  ['WebSockets', 'backend', ['web ?sockets?', 'socket\\.io']],
  ['Authentication', 'backend', ['authentication', 'oauth2?', 'jwt', 'json web tokens?']],
  ['MERN stack', 'backend', ['mern']],
  // Data stores
  ['MongoDB', 'database', ['mongo(?:db)?', 'mongoose']],
  ['PostgreSQL', 'database', ['postgres(?:ql)?']],
  ['MySQL', 'database', ['mysql']],
  ['SQLite', 'database', ['sqlite']],
  ['Redis', 'database', ['redis']],
  ['Elasticsearch', 'database', ['elastic ?search']],
  ['Firebase', 'database', ['firebase', 'firestore']],
  ['DynamoDB', 'database', ['dynamo ?db']],
  ['NoSQL', 'database', ['nosql']],
  // Cloud / DevOps
  ['AWS', 'cloud', ['aws', 'amazon web services', 'ec2', 's3', 'lambda']],
  ['Azure', 'cloud', ['azure']],
  ['Google Cloud', 'cloud', ['gcp', 'google cloud']],
  ['Docker', 'devops', ['docker', 'containeri[sz]ed', 'containers?']],
  ['Kubernetes', 'devops', ['kubernetes', 'k8s']],
  ['CI/CD', 'devops', ['ci/cd', 'ci cd', 'continuous integration', 'continuous delivery', 'continuous deployment', 'github actions', 'jenkins', 'gitlab ci']],
  ['Terraform', 'devops', ['terraform']],
  ['Linux', 'devops', ['linux', 'unix']],
  ['Nginx', 'devops', ['nginx']],
  ['Observability', 'devops', ['observability', 'monitoring', 'prometheus', 'grafana', 'logging']],
  ['Kafka', 'devops', ['kafka']],
  ['RabbitMQ', 'devops', ['rabbitmq']],
  // Tools & practices
  ['Git', 'tooling', ['git', 'github', 'gitlab', 'bitbucket', 'version control']],
  ['Testing', 'practice', ['unit test(?:s|ing)?', 'integration test(?:s|ing)?', 'automated test(?:s|ing)?', 'test-driven', 'tdd', 'testing']],
  ['Jest', 'practice', ['jest']],
  ['Pytest', 'practice', ['pytest']],
  ['Selenium', 'practice', ['selenium']],
  ['Agile', 'practice', ['agile', 'scrum', 'kanban', 'sprints?']],
  ['System design', 'practice', ['system design', 'distributed systems?']],
  ['Data structures', 'practice', ['data structures?']],
  ['Algorithms', 'practice', ['algorithms?']],
  ['OOP', 'practice', ['object[- ]oriented', 'oop']],
  ['Design patterns', 'practice', ['design patterns?']],
  ['Security', 'practice', ['owasp', 'application security', 'secure coding', 'cyber ?security']],
  ['Figma', 'tooling', ['figma']],
  ['Postman', 'tooling', ['postman']],
  ['Jira', 'tooling', ['jira']],
  // Data / AI
  ['Machine learning', 'data', ['machine learning', 'ml']],
  ['Deep learning', 'data', ['deep learning', 'neural networks?']],
  ['NLP', 'data', ['nlp', 'natural language processing']],
  ['Computer vision', 'data', ['computer vision', 'opencv']],
  ['Generative AI', 'data', ['generative ai', 'gen ?ai', 'llms?', 'large language models?', 'prompt engineering']],
  ['TensorFlow', 'data', ['tensorflow', 'keras']],
  ['PyTorch', 'data', ['pytorch']],
  ['scikit-learn', 'data', ['scikit-learn', 'sklearn']],
  ['Pandas', 'data', ['pandas']],
  ['NumPy', 'data', ['numpy']],
  ['Data analysis', 'data', ['data analy(?:sis|tics)', 'exploratory data analysis', 'eda']],
  ['Data visualization', 'data', ['data visuali[sz]ation', 'tableau', 'power ?bi', 'matplotlib']],
  ['Excel', 'data', ['excel', 'spreadsheets?']],
  ['Spark', 'data', ['spark', 'pyspark']],
  ['Hadoop', 'data', ['hadoop']],
  ['ETL', 'data', ['etl', 'data pipelines?']],
  ['Statistics', 'data', ['statistics', 'statistical']],
  // Mobile
  ['Android', 'mobile', ['android']],
  ['iOS', 'mobile', ['ios']],
  ['Flutter', 'mobile', ['flutter']],
  // Interpersonal
  ['Communication', 'interpersonal', ['communication', 'communicat(?:e|ing) (?:clearly|effectively)']],
  ['Teamwork', 'interpersonal', ['team ?work', 'collaborat(?:e|ed|ion|ive|ing)', 'cross-functional']],
  ['Problem solving', 'interpersonal', ['problem[- ]solving', 'troubleshoot(?:ing)?', 'debugging']],
  ['Leadership', 'interpersonal', ['leadership', 'led (?:a|the) team', 'mentor(?:ed|ing)?']],
  ['Time management', 'interpersonal', ['time management', 'prioriti[sz](?:e|ation|ing)']],
];

export const SKILLS = entries.map(([label, category, patterns]) => ({
  label,
  category,
  regex: new RegExp(`${B}(?:${patterns.join('|')})${E}`, 'i'),
}));

export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[^\S\n]+/g, ' ');
}

export function findSkills(text) {
  const normalized = normalizeText(text);
  return SKILLS.filter((skill) => skill.regex.test(normalized));
}

export function hasSkill(text, skill) {
  return skill.regex.test(normalizeText(text));
}
