import { useEffect, useState } from 'react'
import {
  SettingsContentGroup,
  SettingsContentLayout,
  SettingsGroupContent,
  SettingsPageSection,
  SettingsRow,
  SettingsSurface,
  SwitchControl
} from '../shared/designSystem'

interface PetEntry {
  id: string
  displayName: string
  description: string
  spritesheetDataUrl: string
}

const DEFAULT_PET_ID = 'orchestrator'

export default function PetsSettingsPage(): JSX.Element {
  const [pets, setPets] = useState<PetEntry[]>([])
  const [selectedPetId, setSelectedPetId] = useState(DEFAULT_PET_ID)
  const [isOpen, setIsOpen] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importingCodex, setImportingCodex] = useState(false)

  useEffect(() => {
    window.api.pet.getConfig().then((cfg) => {
      const c = cfg as { pets: PetEntry[]; selectedPetId: string; isOpen: boolean }
      setPets(c.pets ?? [])
      setSelectedPetId(c.selectedPetId ?? DEFAULT_PET_ID)
      setIsOpen(c.isOpen ?? true)
    })
  }, [])

  const handleSelect = (id: string): void => {
    setSelectedPetId(id)
    window.api.pet.selectPet(id)
  }

  const handleToggleOpen = (): void => {
    const next = !isOpen
    setIsOpen(next)
    window.api.pet.setOpen(next)
  }

  const handleImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const result = await window.api.pet.importPet()
      if (result) {
        const cfg = await window.api.pet.getConfig()
        const c = cfg as { pets: PetEntry[]; selectedPetId: string; isOpen: boolean }
        setPets(c.pets ?? [])
      }
    } finally {
      setImporting(false)
    }
  }

  const handleImportCodexPets = async (): Promise<void> => {
    setImportingCodex(true)
    try {
      await window.api.pet.importCodexPets()
      const cfg = await window.api.pet.getConfig()
      const c = cfg as { pets: PetEntry[]; selectedPetId: string; isOpen: boolean }
      setPets(c.pets ?? [])
    } finally {
      setImportingCodex(false)
    }
  }

  return (
    <div data-settings-page-module="pets">
      <SettingsPageSection dataTestId="pets-settings-section" className="pets-settings-page">
        <SettingsContentLayout
          title="Pet overlay"
          subtitle="Floating companion controls for Orchestrator."
          dataTestId="settings-content-layout-pets"
        >
          <SettingsContentGroup className="pets-settings-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Pet overlay</div>
              <div className="settings-content-description">Floating companion that shows session activity above all windows.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="pets-settings-surface">
                <SettingsRow
                  label="Overlay"
                  description={isOpen ? 'Enabled' : 'Disabled'}
                  control={<SwitchControl checked={isOpen} label="Toggle pet overlay" onChange={() => handleToggleOpen()} />}
                />
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="pets-settings-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Choose your pet</div>
              <div className="settings-content-description">Select which companion appears in the overlay.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="pets-settings-surface">
                <div className="pet-choice-grid">
                  {pets.map((pet) => {
                    const active = pet.id === selectedPetId
                    return (
                      <button
                        type="button"
                        key={pet.id}
                        data-active={active ? 'true' : 'false'}
                        className="pet-choice-card"
                        onClick={() => handleSelect(pet.id)}
                      >
                        <span
                          className="pet-choice-sprite"
                          style={{ backgroundImage: `url(${pet.spritesheetDataUrl})` }}
                        />
                        <span className="pet-choice-copy">
                          <span className="pet-choice-name">{pet.displayName}</span>
                          {active && <span className="pet-choice-status">Selected</span>}
                        </span>
                      </button>
                    )
                  })}
                  {pets.length === 0 && (
                    <div className="pet-choice-empty">
                      No pets are available yet.
                    </div>
                  )}
                </div>
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="pets-settings-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Import pets</div>
              <div className="settings-content-description">Add pets from a local bundle or copy presets and custom pets from Codex.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="pets-settings-surface">
                <SettingsRow
                  label="Sources"
                  description="Import bundled presets, custom Codex pets, or a local pet package."
                  control={(
                    <div className="settings-actions-inline">
                      <button
                        type="button"
                        className="settings-action-button"
                        onClick={handleImportCodexPets}
                        disabled={importingCodex}
                      >
                        {importingCodex ? 'Importing...' : 'Import from Codex'}
                      </button>
                      <button
                        type="button"
                        className="settings-action-button"
                        onClick={handleImport}
                        disabled={importing}
                      >
                        {importing ? 'Importing...' : 'Import from .zip'}
                      </button>
                    </div>
                  )}
                />
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>
        </SettingsContentLayout>
      </SettingsPageSection>
    </div>
  )
}
