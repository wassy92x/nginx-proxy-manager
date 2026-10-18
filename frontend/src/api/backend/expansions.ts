export type AccessListExpansion = "owner" | "items" | "clients" | "client_cas";
export type AuditLogExpansion = "user";
export type ClientCaExpansion = "owner" | "certificates";
export type CertificateExpansion = "owner" | "proxy_hosts" | "redirection_hosts" | "dead_hosts" | "streams";
export type HostExpansion = "owner" | "certificate";
export type ProxyHostExpansion = "owner" | "access_list" | "certificate";
export type UserExpansion = "permissions";
