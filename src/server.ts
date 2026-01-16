import { Edge } from "edge.js";
import { fileURLToPath } from "url";
import path from "path";
import tailwind from "bun-plugin-tailwind";
import {
  counts,
  createCheckin,
  createGoal,
  createPerson,
  createProject,
  createTeam,
  completeGoalForPerson,
  deleteCheckinForPerson,
  deleteGoalForPerson,
  deletePerson,
  deletePersonFromTeam,
  deleteProjectForPerson,
  deleteSchedule,
  deleteTeam,
  getPerson,
  getSchedule,
  getTeamCheckinStats,
  getTeam,
  listCheckins,
  listDueCheckins,
  listGoals,
  listUpcomingCheckins,
  listPeopleByTeam,
  listProjects,
  listTeams,
  today,
  upsertSchedule,
  updateCheckinForPerson,
  updateGoalForPerson,
  updatePerson,
  updateProjectForPerson,
  updateTeam,
} from "./db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const tailwindEntry = path.join(rootDir, "tailwind.css");
const publicRoot = publicDir.endsWith(path.sep) ? publicDir : `${publicDir}${path.sep}`;

const edge = new Edge();
edge.mount(path.join(rootDir, "views"));

const buildStyles = async () => {
  const result = await Bun.build({
    entrypoints: [tailwindEntry],
    outdir: publicDir,
    root: rootDir,
    plugins: [tailwind],
  });

  if (!result.success) {
    for (const message of result.logs) {
      console.error(message);
    }
    throw new Error("Tailwind build failed.");
  }
};

await buildStyles();

const render = async (template: string, data: Record<string, unknown>) => {
  const html = await edge.render(template, data);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
};

const redirect = (location: string) =>
  new Response(null, {
    status: 303,
    headers: { Location: location },
  });

const parseForm = async (request: Request) => {
  const form = await request.formData();
  const data: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      data[key] = value.trim();
    }
  }
  return data;
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatRating = (value?: number | null) => {
  if (value === null || value === undefined) return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toFixed(1);
};

const servePublicFile = async (pathname: string) => {
  const relativePath = pathname.replace(/^\/+/, "");
  if (!relativePath) return null;
  const filePath = path.resolve(publicDir, relativePath);
  if (!filePath.startsWith(publicRoot)) return null;
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file);
  }
  return null;
};

const server = Bun.serve({
  port: 3000,
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;

    const publicFile = await servePublicFile(pathname);
    if (publicFile) return publicFile;

    if (pathname === "/") {
      const stats = counts();
      const dueCheckins = listDueCheckins();
      const teams = listTeams();
      return render("dashboard", {
        title: "Checked · Dashboard",
        active: "dashboard",
        stats,
        teams,
        dueCheckins,
        today: today(),
        formatDate,
      });
    }

    if (pathname === "/teams" && request.method === "GET") {
      const teams = listTeams();
      return render("teams", {
        title: "Checked · Teams",
        active: "teams",
        teams,
      });
    }

    if (pathname === "/teams" && request.method === "POST") {
      const data = await parseForm(request);
      if (data.name) {
        createTeam(data.name);
      }
      return redirect("/teams");
    }

    const teamDeleteMatch = pathname.match(/^\/teams\/(\d+)\/delete$/);
    if (teamDeleteMatch && request.method === "POST") {
      const teamId = Number(teamDeleteMatch[1]);
      if (Number.isFinite(teamId)) {
        deleteTeam(teamId);
      }
      return redirect("/teams");
    }

    const teamUpdateMatch = pathname.match(/^\/teams\/(\d+)\/update$/);
    if (teamUpdateMatch && request.method === "POST") {
      const teamId = Number(teamUpdateMatch[1]);
      const data = await parseForm(request);
      if (Number.isFinite(teamId) && data.name) {
        updateTeam(teamId, data.name);
      }
      return redirect(`/teams/${teamId}`);
    }

    const teamMatch = pathname.match(/^\/teams\/(\d+)$/);
    if (teamMatch && request.method === "GET") {
      const teamId = Number(teamMatch[1]);
      const team = getTeam(teamId);
      if (!team) return new Response("Team not found", { status: 404 });
      const people = listPeopleByTeam(teamId);
      const schedule = getSchedule(teamId);
      const due = schedule ? schedule.next_due <= today() : false;
      const teamCheckinStats = getTeamCheckinStats(teamId);
      return render("team", {
        title: `Checked · ${team.name}`,
        active: "teams",
        team,
        people,
        schedule,
        due,
        teamCheckinStats,
        today: today(),
        formatDate,
        formatRating,
      });
    }

    const teamPeopleMatch = pathname.match(/^\/teams\/(\d+)\/people$/);
    if (teamPeopleMatch && request.method === "POST") {
      const teamId = Number(teamPeopleMatch[1]);
      const data = await parseForm(request);
      if (data.name) {
        createPerson(teamId, data.name, data.title || null);
      }
      return redirect(`/teams/${teamId}`);
    }

    const teamPersonDeleteMatch = pathname.match(
      /^\/teams\/(\d+)\/people\/(\d+)\/delete$/
    );
    if (teamPersonDeleteMatch && request.method === "POST") {
      const teamId = Number(teamPersonDeleteMatch[1]);
      const personId = Number(teamPersonDeleteMatch[2]);
      if (Number.isFinite(teamId) && Number.isFinite(personId)) {
        deletePersonFromTeam(teamId, personId);
      }
      return redirect(`/teams/${teamId}`);
    }

    const personMatch = pathname.match(/^\/people\/(\d+)$/);
    if (personMatch && request.method === "GET") {
      const personId = Number(personMatch[1]);
      const person = getPerson(personId);
      if (!person) return new Response("Person not found", { status: 404 });
      const goals = listGoals(personId);
      const projects = listProjects(personId);
      const checkins = listCheckins(personId);
      const teamSchedule = getSchedule(Number(person.team_id));
      const teamDue = teamSchedule
        ? teamSchedule.next_due <= today()
        : false;
      return render("person", {
        title: `Checked · ${person.name}`,
        active: "teams",
        person,
        goals,
        projects,
        checkins,
        teamSchedule,
        teamDue,
        today: today(),
        formatDate,
      });
    }

    const personDeleteMatch = pathname.match(/^\/people\/(\d+)\/delete$/);
    if (personDeleteMatch && request.method === "POST") {
      const personId = Number(personDeleteMatch[1]);
      const person = Number.isFinite(personId) ? getPerson(personId) : null;
      if (person) {
        deletePerson(personId);
        return redirect(`/teams/${person.team_id}`);
      }
      return redirect("/teams");
    }

    const personUpdateMatch = pathname.match(/^\/people\/(\d+)\/update$/);
    if (personUpdateMatch && request.method === "POST") {
      const personId = Number(personUpdateMatch[1]);
      const data = await parseForm(request);
      if (Number.isFinite(personId) && data.name) {
        const title = data.title ? data.title : null;
        updatePerson(personId, data.name, title);
      }
      return redirect(`/people/${personId}`);
    }

    const personGoalDeleteMatch = pathname.match(
      /^\/people\/(\d+)\/goals\/(\d+)\/delete$/
    );
    if (personGoalDeleteMatch && request.method === "POST") {
      const personId = Number(personGoalDeleteMatch[1]);
      const goalId = Number(personGoalDeleteMatch[2]);
      if (Number.isFinite(personId) && Number.isFinite(goalId)) {
        deleteGoalForPerson(personId, goalId);
      }
      return redirect(`/people/${personId}`);
    }

    const personGoalUpdateMatch = pathname.match(
      /^\/people\/(\d+)\/goals\/(\d+)\/update$/
    );
    if (personGoalUpdateMatch && request.method === "POST") {
      const personId = Number(personGoalUpdateMatch[1]);
      const goalId = Number(personGoalUpdateMatch[2]);
      const data = await parseForm(request);
      if (Number.isFinite(personId) && Number.isFinite(goalId)) {
        if (data.goal && data.expectation) {
          updateGoalForPerson(personId, goalId, data.goal, data.expectation);
        }
      }
      return redirect(`/people/${personId}`);
    }

    const personGoalCompleteMatch = pathname.match(
      /^\/people\/(\d+)\/goals\/(\d+)\/complete$/
    );
    if (personGoalCompleteMatch && request.method === "POST") {
      const personId = Number(personGoalCompleteMatch[1]);
      const goalId = Number(personGoalCompleteMatch[2]);
      if (Number.isFinite(personId) && Number.isFinite(goalId)) {
        completeGoalForPerson(personId, goalId);
      }
      return redirect(`/people/${personId}`);
    }

    const personGoalsMatch = pathname.match(/^\/people\/(\d+)\/goals$/);
    if (personGoalsMatch && request.method === "POST") {
      const personId = Number(personGoalsMatch[1]);
      const data = await parseForm(request);
      if (data.goal && data.expectation) {
        createGoal(personId, data.goal, data.expectation);
      }
      return redirect(`/people/${personId}`);
    }

    const personProjectDeleteMatch = pathname.match(
      /^\/people\/(\d+)\/projects\/(\d+)\/delete$/
    );
    if (personProjectDeleteMatch && request.method === "POST") {
      const personId = Number(personProjectDeleteMatch[1]);
      const projectId = Number(personProjectDeleteMatch[2]);
      if (Number.isFinite(personId) && Number.isFinite(projectId)) {
        deleteProjectForPerson(personId, projectId);
      }
      return redirect(`/people/${personId}`);
    }

    const personProjectUpdateMatch = pathname.match(
      /^\/people\/(\d+)\/projects\/(\d+)\/update$/
    );
    if (personProjectUpdateMatch && request.method === "POST") {
      const personId = Number(personProjectUpdateMatch[1]);
      const projectId = Number(personProjectUpdateMatch[2]);
      const data = await parseForm(request);
      if (Number.isFinite(personId) && Number.isFinite(projectId)) {
        if (data.project && data.expectation) {
          updateProjectForPerson(
            personId,
            projectId,
            data.project,
            data.expectation
          );
        }
      }
      return redirect(`/people/${personId}`);
    }

    const personProjectsMatch = pathname.match(/^\/people\/(\d+)\/projects$/);
    if (personProjectsMatch && request.method === "POST") {
      const personId = Number(personProjectsMatch[1]);
      const data = await parseForm(request);
      if (data.project && data.expectation) {
        createProject(personId, data.project, data.expectation);
      }
      return redirect(`/people/${personId}`);
    }

    const personCheckinDeleteMatch = pathname.match(
      /^\/people\/(\d+)\/checkins\/(\d+)\/delete$/
    );
    if (personCheckinDeleteMatch && request.method === "POST") {
      const personId = Number(personCheckinDeleteMatch[1]);
      const checkinId = Number(personCheckinDeleteMatch[2]);
      if (Number.isFinite(personId) && Number.isFinite(checkinId)) {
        deleteCheckinForPerson(personId, checkinId);
      }
      return redirect(`/people/${personId}#checkins`);
    }

    const personCheckinUpdateMatch = pathname.match(
      /^\/people\/(\d+)\/checkins\/(\d+)\/update$/
    );
    if (personCheckinUpdateMatch && request.method === "POST") {
      const personId = Number(personCheckinUpdateMatch[1]);
      const checkinId = Number(personCheckinUpdateMatch[2]);
      const data = await parseForm(request);
      const rating = Math.min(5, Math.max(1, Number(data.rating)));
      const notes = data.notes ? data.notes : null;
      if (Number.isFinite(personId) && Number.isFinite(checkinId)) {
        if (Number.isFinite(rating)) {
          updateCheckinForPerson(personId, checkinId, rating, notes);
        }
      }
      return redirect(`/people/${personId}#checkins`);
    }

    const personCheckinMatch = pathname.match(/^\/people\/(\d+)\/checkins$/);
    if (personCheckinMatch && request.method === "POST") {
      const personId = Number(personCheckinMatch[1]);
      const data = await parseForm(request);
      const rating = Math.min(5, Math.max(1, Number(data.rating)));
      const notes = data.notes ? data.notes : null;
      if (Number.isFinite(rating)) {
        const person = getPerson(personId);
        if (person) {
          createCheckin(Number(person.team_id), personId, rating, notes);
        }
      }
      return redirect(`/people/${personId}#checkins`);
    }

    const teamScheduleDeleteMatch = pathname.match(
      /^\/teams\/(\d+)\/schedule\/delete$/
    );
    if (teamScheduleDeleteMatch && request.method === "POST") {
      const teamId = Number(teamScheduleDeleteMatch[1]);
      if (Number.isFinite(teamId)) {
        deleteSchedule(teamId);
      }
      return redirect(`/teams/${teamId}#schedule`);
    }

    const teamScheduleMatch = pathname.match(/^\/teams\/(\d+)\/schedule$/);
    if (teamScheduleMatch && request.method === "POST") {
      const teamId = Number(teamScheduleMatch[1]);
      const data = await parseForm(request);
      const cadenceDays = Number(data.cadence_days);
      const startDate = data.start_date;
      if (Number.isFinite(cadenceDays) && cadenceDays > 0) {
        upsertSchedule(teamId, cadenceDays, startDate);
      }
      return redirect(`/teams/${teamId}#schedule`);
    }

    const teamCheckinMatch = pathname.match(/^\/teams\/(\d+)\/checkins$/);
    if (teamCheckinMatch && request.method === "POST") {
      const teamId = Number(teamCheckinMatch[1]);
      const data = await parseForm(request);
      const personId = Number(data.person_id);
      const rating = Math.min(5, Math.max(1, Number(data.rating)));
      const notes = data.notes ? data.notes : null;
      if (Number.isFinite(personId) && Number.isFinite(rating)) {
        const person = getPerson(personId);
        if (person && Number(person.team_id) === teamId) {
          createCheckin(teamId, personId, rating, notes);
        }
      }
      return redirect(`/teams/${teamId}#checkins`);
    }

    if (pathname === "/checkins" && request.method === "GET") {
      const dueCheckins = listDueCheckins();
      const upcomingCheckins = listUpcomingCheckins(3);
      return render("checkins", {
        title: "Checked · Checkins",
        active: "checkins",
        dueCheckins,
        upcomingCheckins,
        today: today(),
        formatDate,
      });
    }

    if (pathname === "/health") {
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Checked running at http://localhost:${server.port}`);
