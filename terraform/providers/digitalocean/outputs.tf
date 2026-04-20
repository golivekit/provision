output "server_ip" {
  description = "Public IPv4 address of the Droplet"
  value       = digitalocean_droplet.server.ipv4_address
}

output "server_ipv6" {
  description = "Public IPv6 address of the Droplet"
  value       = try(digitalocean_droplet.server.ipv6_address, null)
}

output "server_id" {
  description = "Droplet ID"
  value       = digitalocean_droplet.server.id
}

output "ssh_command" {
  description = "SSH connection command"
  value       = "ssh deploy@${digitalocean_droplet.server.ipv4_address}"
}
