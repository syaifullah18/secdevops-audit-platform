{{- define "sdap.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "sdap.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* Selector labels. Usage: include "sdap.selectorLabels" (dict "ctx" . "component" "api") */}}
{{- define "sdap.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sdap.name" .ctx }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "sdap.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .ctx.Chart.Name .ctx.Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "sdap.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .ctx.Release.Service }}
{{- end -}}

{{- define "sdap.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- include "sdap.fullname" . -}}
{{- else -}}
default
{{- end -}}
{{- end -}}

{{/* Usage: include "sdap.image" (dict "ctx" . "image" .Values.api.image) */}}
{{- define "sdap.image" -}}
{{- $tag := default (default .ctx.Chart.AppVersion .ctx.Values.image.tag) .image.tag -}}
{{- if .ctx.Values.image.registry -}}
{{- printf "%s/%s:%s" (.ctx.Values.image.registry | trimSuffix "/") .image.repository $tag -}}
{{- else -}}
{{- printf "%s:%s" .image.repository $tag -}}
{{- end -}}
{{- end -}}

{{/* Secret holding DATABASE_URL, REDIS_URL and optional keys. Created by you, never by this chart. */}}
{{- define "sdap.secretName" -}}
{{- default (printf "%s-secrets" (include "sdap.fullname" .)) .Values.secrets.existingSecret -}}
{{- end -}}

{{/* Env shared by api and worker: ConfigMap plus Secret references (never values). */}}
{{- define "sdap.commonEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "sdap.secretName" . }}
      key: {{ .Values.secrets.databaseUrlKey }}
- name: REDIS_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "sdap.secretName" . }}
      key: {{ .Values.secrets.redisUrlKey }}
{{- range .Values.secrets.optionalKeys }}
- name: {{ . }}
  valueFrom:
    secretKeyRef:
      name: {{ include "sdap.secretName" $ }}
      key: {{ . }}
      optional: true
{{- end }}
{{- end -}}
