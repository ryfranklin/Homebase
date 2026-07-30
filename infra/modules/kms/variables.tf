variable "alias" {
  description = "Alias for the key, without the 'alias/' prefix."
  type        = string
}

variable "description" {
  description = "Human readable description of the key's purpose."
  type        = string
  default     = "Homebase managed key"
}

variable "deletion_window_in_days" {
  description = "Waiting period before a scheduled key deletion completes."
  type        = number
  default     = 30
}

variable "enable_key_rotation" {
  description = "Whether automatic annual key rotation is enabled. Rotation is on by default."
  type        = bool
  default     = true
}

variable "service_principals" {
  description = "AWS service principals (for example logs.amazonaws.com) allowed to use the key."
  type        = list(string)
  default     = []
}

variable "policy" {
  description = "Optional full key policy JSON. When null, a default policy (account root plus any service_principals) is used."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to the key."
  type        = map(string)
  default     = {}
}
