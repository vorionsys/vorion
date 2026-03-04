# Agent

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | Pointer to **string** | Unique agent identifier | [optional] 
**Name** | Pointer to **string** | Agent display name | [optional] 
**Description** | Pointer to **string** | Agent description | [optional] 
**Status** | Pointer to **string** | Current agent status | [optional] 
**TrustScore** | Pointer to **int32** | Current trust score (0-1000) | [optional] 
**TrustTier** | Pointer to **string** | Trust tier based on score | [optional] 
**CertificationLevel** | Pointer to **string** | Council certification level | [optional] 
**Published** | Pointer to **bool** | Whether agent is listed on marketplace | [optional] 
**Capabilities** | Pointer to **[]string** | List of agent capabilities | [optional] 
**CreatedAt** | Pointer to **time.Time** | Creation timestamp | [optional] 

## Methods

### NewAgent

`func NewAgent() *Agent`

NewAgent instantiates a new Agent object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewAgentWithDefaults

`func NewAgentWithDefaults() *Agent`

NewAgentWithDefaults instantiates a new Agent object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *Agent) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *Agent) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *Agent) SetId(v string)`

SetId sets Id field to given value.

### HasId

`func (o *Agent) HasId() bool`

HasId returns a boolean if a field has been set.

### GetName

`func (o *Agent) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *Agent) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *Agent) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *Agent) HasName() bool`

HasName returns a boolean if a field has been set.

### GetDescription

`func (o *Agent) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *Agent) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *Agent) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *Agent) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetStatus

`func (o *Agent) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *Agent) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *Agent) SetStatus(v string)`

SetStatus sets Status field to given value.

### HasStatus

`func (o *Agent) HasStatus() bool`

HasStatus returns a boolean if a field has been set.

### GetTrustScore

`func (o *Agent) GetTrustScore() int32`

GetTrustScore returns the TrustScore field if non-nil, zero value otherwise.

### GetTrustScoreOk

`func (o *Agent) GetTrustScoreOk() (*int32, bool)`

GetTrustScoreOk returns a tuple with the TrustScore field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTrustScore

`func (o *Agent) SetTrustScore(v int32)`

SetTrustScore sets TrustScore field to given value.

### HasTrustScore

`func (o *Agent) HasTrustScore() bool`

HasTrustScore returns a boolean if a field has been set.

### GetTrustTier

`func (o *Agent) GetTrustTier() string`

GetTrustTier returns the TrustTier field if non-nil, zero value otherwise.

### GetTrustTierOk

`func (o *Agent) GetTrustTierOk() (*string, bool)`

GetTrustTierOk returns a tuple with the TrustTier field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTrustTier

`func (o *Agent) SetTrustTier(v string)`

SetTrustTier sets TrustTier field to given value.

### HasTrustTier

`func (o *Agent) HasTrustTier() bool`

HasTrustTier returns a boolean if a field has been set.

### GetCertificationLevel

`func (o *Agent) GetCertificationLevel() string`

GetCertificationLevel returns the CertificationLevel field if non-nil, zero value otherwise.

### GetCertificationLevelOk

`func (o *Agent) GetCertificationLevelOk() (*string, bool)`

GetCertificationLevelOk returns a tuple with the CertificationLevel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCertificationLevel

`func (o *Agent) SetCertificationLevel(v string)`

SetCertificationLevel sets CertificationLevel field to given value.

### HasCertificationLevel

`func (o *Agent) HasCertificationLevel() bool`

HasCertificationLevel returns a boolean if a field has been set.

### GetPublished

`func (o *Agent) GetPublished() bool`

GetPublished returns the Published field if non-nil, zero value otherwise.

### GetPublishedOk

`func (o *Agent) GetPublishedOk() (*bool, bool)`

GetPublishedOk returns a tuple with the Published field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPublished

`func (o *Agent) SetPublished(v bool)`

SetPublished sets Published field to given value.

### HasPublished

`func (o *Agent) HasPublished() bool`

HasPublished returns a boolean if a field has been set.

### GetCapabilities

`func (o *Agent) GetCapabilities() []string`

GetCapabilities returns the Capabilities field if non-nil, zero value otherwise.

### GetCapabilitiesOk

`func (o *Agent) GetCapabilitiesOk() (*[]string, bool)`

GetCapabilitiesOk returns a tuple with the Capabilities field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCapabilities

`func (o *Agent) SetCapabilities(v []string)`

SetCapabilities sets Capabilities field to given value.

### HasCapabilities

`func (o *Agent) HasCapabilities() bool`

HasCapabilities returns a boolean if a field has been set.

### GetCreatedAt

`func (o *Agent) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *Agent) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *Agent) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.

### HasCreatedAt

`func (o *Agent) HasCreatedAt() bool`

HasCreatedAt returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


