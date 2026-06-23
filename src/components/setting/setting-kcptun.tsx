import { SettingsRounded } from '@mui/icons-material'
import { Typography } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useRef, useState } from 'react'

import { DialogRef, Switch, TooltipIcon } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import { getKcptunRunning, restartKcptun, stopKcptun } from '@/services/cmds'

import { KcptunViewer } from './mods/kcptun-viewer'
import { SettingItem, SettingList } from './mods/setting-comp'

interface Props {
  onError: (err: Error) => void
}

const SettingKcptun = ({ onError }: Props) => {
  const { verge, patchVerge } = useVerge()
  const viewerRef = useRef<DialogRef>(null)
  const [running, setRunning] = useState(false)

  const enable = verge?.enable_kcptun ?? false
  const localPort = verge?.kcptun_local_port ?? 12948

  const refreshStatus = async () => {
    try {
      setRunning(await getKcptunRunning())
    } catch {
      setRunning(false)
    }
  }

  useEffect(() => {
    refreshStatus()
    const id = setInterval(refreshStatus, 3000)
    return () => clearInterval(id)
  }, [])

  const onToggle = useLockFn(async (checked: boolean) => {
    try {
      await patchVerge({ enable_kcptun: checked })
      if (checked) {
        await restartKcptun()
      } else {
        await stopKcptun()
      }
      await refreshStatus()
    } catch (err: any) {
      await patchVerge({ enable_kcptun: !checked }).catch(() => {})
      onError(err)
    }
  })

  return (
    <SettingList title="kcptun 加速">
      <KcptunViewer ref={viewerRef} onSaved={refreshStatus} />

      <SettingItem
        label="启用 kcptun 加速"
        extra={
          <TooltipIcon
            title="单上游：clash 节点经本地 kcptun client → KCP/UDP 隧道 → 远端 kcptun server 落地"
            sx={{ opacity: 0.7 }}
          />
        }
      >
        <Switch
          edge="end"
          checked={enable}
          onChange={(_, checked) => onToggle(checked)}
        />
      </SettingItem>

      <SettingItem
        label="kcptun 配置"
        extra={
          <TooltipIcon
            icon={SettingsRounded}
            onClick={() => viewerRef.current?.open()}
          />
        }
        onClick={() => viewerRef.current?.open()}
      >
        <Typography sx={{ py: '7px', pr: 1, opacity: 0.75 }}>
          {running ? `运行中 · 127.0.0.1:${localPort}` : '未运行'}
        </Typography>
      </SettingItem>
    </SettingList>
  )
}

export default SettingKcptun
