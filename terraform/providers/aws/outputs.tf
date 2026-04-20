output "server_ip" {
  description = "Elastic IP (static public IP)"
  value       = try(aws_eip.server[0].public_ip, aws_instance.server.public_ip, null)
}

output "server_ipv6" {
  description = "Public IPv6 address"
  value       = try(aws_instance.server.ipv6_addresses[0], null)
}

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.server.id
}

output "ssh_command" {
  description = "SSH connection command"
  value       = var.ipv4_enabled ? "ssh deploy@${try(aws_eip.server[0].public_ip, aws_instance.server.public_ip)}" : "ssh deploy@${aws_instance.server.ipv6_addresses[0]}"
}
