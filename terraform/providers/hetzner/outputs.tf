output "server_ip" {
  description = "Public IPv4 address"
  value       = hcloud_server.server.ipv4_address
}

output "server_ipv6" {
  description = "Public IPv6 address"
  value       = try(hcloud_server.server.ipv6_address, null)
}

output "server_id" {
  description = "Hetzner server ID"
  value       = hcloud_server.server.id
}

output "ssh_command" {
  description = "SSH connection command"
  value       = "ssh deploy@${hcloud_server.server.ipv4_address}"
}
