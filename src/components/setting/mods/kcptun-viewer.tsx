import {
  Box,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  TextField,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useImperativeHandle, useState, type Ref } from 'react'

import { BaseDialog, DialogRef } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import { restartKcptun } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const CRYPT_OPTIONS = [
  'aes',
  'aes-128',
  'aes-192',
  'salsa20',
  'blowfish',
  'twofish',
  'cast5',
  '3des',
  'tea',
  'xtea',
  'xor',
  'sm4',
  'none',
]
const MODE_OPTIONS = ['fast3', 'fast2', 'fast', 'normal', 'manual']

const rowSx = {
  padding: '5px 2px',
  display: 'flex',
  justifyContent: 'space-between',
}
const ctrlSx = { width: 210 }

export function KcptunViewer({
  ref,
  onSaved,
}: {
  ref?: Ref<DialogRef>
  onSaved?: () => void
}) {
  const { verge, patchVerge } = useVerge()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [remoteAddr, setRemoteAddr] = useState('')
  const [key, setKey] = useState('')
  const [crypt, setCrypt] = useState('aes')
  const [mode, setMode] = useState('fast')
  const [localPort, setLocalPort] = useState('12948')
  const [conn, setConn] = useState('1')
  const [extraArgs, setExtraArgs] = useState('')

  useImperativeHandle(ref, () => ({
    open: () => {
      setRemoteAddr(verge?.kcptun_remote_addr ?? '')
      setKey(verge?.kcptun_key ?? '')
      setCrypt(verge?.kcptun_crypt ?? 'aes')
      setMode(verge?.kcptun_mode ?? 'fast')
      setLocalPort(String(verge?.kcptun_local_port ?? 12948))
      setConn(String(verge?.kcptun_conn ?? 1))
      setExtraArgs(verge?.kcptun_extra_args ?? '')
      setOpen(true)
    },
    close: () => setOpen(false),
  }))

  const onSave = useLockFn(async () => {
    const port = parseInt(localPort, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      showNotice.error('本地端口需为 1-65535 的整数')
      return
    }
    const connNum = parseInt(conn, 10)
    try {
      setSaving(true)
      await patchVerge({
        kcptun_remote_addr: remoteAddr.trim(),
        kcptun_key: key,
        kcptun_crypt: crypt,
        kcptun_mode: mode,
        kcptun_local_port: port,
        kcptun_conn: Number.isInteger(connNum) && connNum > 0 ? connNum : 1,
        kcptun_extra_args: extraArgs.trim(),
      })
      // 仅在已启用时重启以使新配置生效
      if (verge?.enable_kcptun) await restartKcptun()
      showNotice.success('已保存 kcptun 配置')
      setOpen(false)
      onSaved?.()
    } catch (err) {
      showNotice.error(err as any)
    } finally {
      setSaving(false)
    }
  })

  return (
    <BaseDialog
      open={open}
      title="kcptun 配置"
      contentSx={{ width: 440 }}
      okBtn={saving ? '保存中…' : '保存'}
      cancelBtn="取消"
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem sx={rowSx}>
          <ListItemText primary="远端地址 (VPS:端口)" />
          <TextField
            size="small"
            sx={ctrlSx}
            value={remoteAddr}
            placeholder="example.com:29900"
            onChange={(e) => setRemoteAddr(e.target.value)}
            disabled={saving}
          />
        </ListItem>

        <ListItem sx={rowSx}>
          <ListItemText primary="密钥 (key)" />
          <TextField
            size="small"
            type="password"
            autoComplete="new-password"
            sx={ctrlSx}
            value={key}
            placeholder="与 server 一致"
            onChange={(e) => setKey(e.target.value)}
            disabled={saving}
          />
        </ListItem>

        <ListItem sx={rowSx}>
          <ListItemText primary="加密 (crypt)" />
          <Select
            size="small"
            sx={ctrlSx}
            value={crypt}
            onChange={(e) => setCrypt(e.target.value)}
            disabled={saving}
          >
            {CRYPT_OPTIONS.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </Select>
        </ListItem>

        <ListItem sx={rowSx}>
          <ListItemText primary="模式 (mode)" />
          <Select
            size="small"
            sx={ctrlSx}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={saving}
          >
            {MODE_OPTIONS.map((m) => (
              <MenuItem key={m} value={m}>
                {m}
              </MenuItem>
            ))}
          </Select>
        </ListItem>

        <ListItem sx={rowSx}>
          <ListItemText primary="本地监听端口" />
          <TextField
            size="small"
            sx={ctrlSx}
            value={localPort}
            placeholder="12948"
            onChange={(e) => setLocalPort(e.target.value)}
            disabled={saving}
          />
        </ListItem>

        <ListItem sx={rowSx}>
          <ListItemText primary="UDP 连接数 (conn)" />
          <TextField
            size="small"
            sx={ctrlSx}
            value={conn}
            placeholder="1"
            onChange={(e) => setConn(e.target.value)}
            disabled={saving}
          />
        </ListItem>

        <ListItem sx={rowSx}>
          <ListItemText primary="高级参数 (可选)" />
          <TextField
            size="small"
            sx={ctrlSx}
            value={extraArgs}
            placeholder="-nocomp -sndwnd 1024"
            onChange={(e) => setExtraArgs(e.target.value)}
            disabled={saving}
          />
        </ListItem>
      </List>

      <Box sx={{ px: 1, pb: 1, opacity: 0.7, fontSize: 12, lineHeight: 1.6 }}>
        远端需运行 kcptun server（见 kcptun 仓库 deploy/）。key/crypt/mode 两端必须一致。
        启用后，把要加速的 clash 节点 server 改为 127.0.0.1:{localPort || '12948'}。
      </Box>
    </BaseDialog>
  )
}
