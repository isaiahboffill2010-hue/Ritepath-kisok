export type WebApp = {
  id: string;
  name: string;
  icon: string;
  url: string;
};

export const webApps: WebApp[] = [
  {
    id: "ritepath",
    name: "RitePath",
    icon: "/Ritepath.png",
    url: "https://ritepath.com"
  }
];

export function getWebAppById(id: string): WebApp | undefined {
  return webApps.find(app => app.id === id);
}
