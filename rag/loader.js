const fs = require("fs");
const path = require("path");

module.exports = function loadOwnerData() {
  const filePath = path.join(__dirname, "../data/owner_profile.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  const docs = [];

  const push = (content, field) => {
    if (content && typeof content === "string") {
      docs.push({
        content: content.trim(),
        metadata: { field }
      });
    }
  };

  /* ---------------- PROFILE SUMMARY ---------------- */
  if (raw.profileSummary) {
    push(raw.profileSummary, "summary");
  }

  /* ---------------- PERSONAL ---------------- */
  if (raw.personal?.name) {
    push(`My name is ${raw.personal.name}.`, "name");
  }

  if (raw.personal?.parents) {
    const p = raw.personal.parents;

    if (p.description) {
      push(p.description, "parents");
    } else if (p.father && p.mother) {
      push(
        `My father's name is ${p.father} and my mother's name is ${p.mother}.`,
        "parents"
      );
    }
  }

  /* ---------------- EDUCATION ---------------- */
  if (Array.isArray(raw.education)) {
    raw.education.forEach(edu => {
      if (edu.description) {
        push(edu.description, "education");
      } else {
        push(
          `I completed ${edu.degree} in ${edu.field}. Status: ${edu.status}.`,
          "education"
        );
      }
    });
  }

  /* ---------------- SKILLS ---------------- */
  if (raw.skills && typeof raw.skills === "object") {
    Object.entries(raw.skills).forEach(([category, data]) => {
      if (data.description) {
        push(data.description, "skills");
      } else if (Array.isArray(data.list)) {
        push(
          `My ${category} skills include ${data.list.join(", ")}.`,
          "skills"
        );
      }
    });
  }

  /* ---------------- PROJECTS ---------------- */
  if (Array.isArray(raw.projects)) {
    raw.projects.forEach(project => {
      if (project.description) {
        push(
          `I worked on the project "${project.name}". ${project.description}`,
          "projects"
        );
      } else {
        push(`I worked on the project "${project.name}".`, "projects");
      }
    });
  }

  /* ---------------- GOALS ---------------- */
  if (raw.goals) {
    if (raw.goals.description) {
      push(raw.goals.description, "goals");
    }

    if (raw.goals.career) {
      push(`My career goal is to ${raw.goals.career}.`, "goals");
    }
  }

  /* ---------------- HABITS ---------------- */
  if (raw.habits && typeof raw.habits === "object") {
    Object.entries(raw.habits).forEach(([type, data]) => {
      if (data.description) {
        push(data.description, "habits");
      } else if (Array.isArray(data.list)) {
        push(
          `My ${type} habits include ${data.list.join(", ")}.`,
          "habits"
        );
      }
    });
  }

  /* ---------------- HOBBIES ---------------- */
  if (raw.hobbies) {
    if (raw.hobbies.description) {
      push(raw.hobbies.description, "hobbies");
    } else if (Array.isArray(raw.hobbies.list)) {
      push(
        `My hobbies include ${raw.hobbies.list.join(", ")}.`,
        "hobbies"
      );
    }
  }

  console.log(`✅ Loaded ${docs.length} owner profile chunks`);
  return docs;
};
