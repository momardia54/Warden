import { Boxes, KeyRound, Braces, LayoutDashboard, LogOut, Monitor, Moon, MoreHorizontal, ShieldCheck, Sun } from "lucide-react"
import { NavLink, useFetcher, useLocation } from "react-router"
import { useTheme } from "next-themes"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "#/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu"

const NAV = [
  { title: "Overview", to: "/overview", icon: LayoutDashboard },
  { title: "Apps", to: "/apps", icon: Boxes },
  { title: "Licences", to: "/licenses", icon: KeyRound },
  { title: "API", to: "/api-keys", icon: Braces },
]

function NavGroup({ label, items }: { label: string; items: typeof NAV }) {
  const location = useLocation()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton asChild isActive={location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)} tooltip={item.title}>
                <NavLink to={item.to} prefetch="intent" className={({ isPending }) => (isPending ? "opacity-60" : undefined)}>
                  <item.icon />
                  <span>{item.title}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar({ username, ...props }: { username: string } & React.ComponentProps<typeof Sidebar>) {
  const fetcher = useFetcher()
  const { setTheme } = useTheme()

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/overview">
                <img src="/favicon.svg" alt="" className="size-8 rounded-lg" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Warden</span>
                  <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <ShieldCheck className="size-3" /> Licence manager
                  </span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Manage" items={NAV} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg font-semibold">
                    {username.charAt(0).toUpperCase()}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{username}</span>
                    <span className="truncate text-xs text-muted-foreground">Administrator</span>
                  </div>
                  <MoreHorizontal className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg" side="bottom" align="end" sideOffset={4}>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Sun />
                    Theme
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => setTheme("light")}>
                      <Sun /> Light
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("dark")}>
                      <Moon /> Dark
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme("system")}>
                      <Monitor /> System
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => fetcher.submit(null, { method: "post", action: "/logout" })}>
                  <LogOut />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
